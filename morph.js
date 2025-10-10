export class Morph {
    constructor(device, shaderCode) {
        this.device = device;
        this.shaderModule = device.createShaderModule({ code: shaderCode });
        this.pipeline = null;
        this.buffers = {};
        this.width = 0;
        this.height = 0;
        this.numPixels = 0;
    }

    async prepare(initialImageData, targetImageData, mode) {
        this.width = initialImageData.width;
        this.height = initialImageData.height;
        this.numPixels = this.width * this.height;

        const initialPixels = this._getPixelData(initialImageData, mode);
        const targetPixels = this._getPixelData(targetImageData, mode);

        // Sort target pixels by value
        targetPixels.sort((a, b) => a.value - b.value);

        const mapping = this._createMapping(initialPixels, targetPixels);

        this._createBuffers(initialPixels, mapping);
        this._createPipeline();
    }

    _getPixelData(imageData, mode) {
        const data = imageData.data;
        const pixels = [];
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            const index = i / 4;
            const x = index % this.width;
            const y = Math.floor(index / this.width);

            let value;
            if (mode === 'hue') {
                value = this._rgbToHsv(r, g, b)[0];
            } else { // luminance
                value = 0.299 * r + 0.587 * g + 0.114 * b;
            }

            pixels.push({ r, g, b, a, x, y, value, originalIndex: index });
        }
        return pixels;
    }
    
    _rgbToHsv(r, g, b) {
        r /= 255, g /= 255, b /= 255;
        let max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, v = max;
        let d = max - min;
        s = max == 0 ? 0 : d / max;
        if (max == min) {
            h = 0;
        } else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h, s, v];
    }

    _createMapping(initialPixels, sortedTargetPixels) {
        // Sort initial pixels by value to match with target pixels
        const sortedInitialPixels = [...initialPixels].sort((a, b) => a.value - b.value);
        
        const mapping = new Array(this.numPixels);
        for(let i = 0; i < this.numPixels; i++) {
            const initialPixel = sortedInitialPixels[i];
            const targetPixel = sortedTargetPixels[i];
            mapping[initialPixel.originalIndex] = { targetX: targetPixel.x, targetY: targetPixel.y };
        }
        return mapping;
    }

    _createBuffers(initialPixels, mapping) {
        // vec4 for color (RGBA), vec2 for current pos, vec2 for target pos
        const particleData = new Float32Array(this.numPixels * 8); 
        for (let i = 0; i < this.numPixels; i++) {
            const p = initialPixels[i];
            const m = mapping[i];
            particleData[i * 8 + 0] = p.r / 255.0;
            particleData[i * 8 + 1] = p.g / 255.0;
            particleData[i * 8 + 2] = p.b / 255.0;
            particleData[i * 8 + 3] = p.a / 255.0;
            particleData[i * 8 + 4] = p.x;
            particleData[i * 8 + 5] = p.y;
            particleData[i * 8 + 6] = m.targetX;
            particleData[i * 8 + 7] = m.targetY;
        }

        this.buffers.particles = this.device.createBuffer({
            size: particleData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Float32Array(this.buffers.particles.getMappedRange()).set(particleData);
        this.buffers.particles.unmap();

        this.buffers.output = this.device.createBuffer({
            size: particleData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.buffers.read = this.device.createBuffer({
            size: particleData.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
    }

    _createPipeline() {
        this.pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: this.shaderModule,
                entryPoint: 'main',
            },
        });
    }

    async runStep() {
        if (!this.pipeline) return;

        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.buffers.particles } },
                { binding: 1, resource: { buffer: this.buffers.output } },
            ],
        });

        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(this.numPixels / 64));
        passEncoder.end();
        
        // Copy output back to particles buffer for next step
        commandEncoder.copyBufferToBuffer(
            this.buffers.output, 0,
            this.buffers.particles, 0,
            this.buffers.particles.size
        );

        this.device.queue.submit([commandEncoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
    }

    async getParticleData() {
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(
            this.buffers.particles, 0,
            this.buffers.read, 0,
            this.buffers.particles.size
        );
        this.device.queue.submit([commandEncoder.finish()]);

        await this.buffers.read.mapAsync(GPUMapMode.READ);
        const particleData = new Float32Array(this.buffers.read.getMappedRange()).slice();
        this.buffers.read.unmap();
        return particleData;
    }
    
    async getFinalFrame() {
        // This is a simplified version. For a true final frame, 
        // we'd need to run the simulation until all particles reach their destination.
        // For now, we just map the initial colors to the target positions.
        const finalImageData = new ImageData(this.width, this.height);
        
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(
            this.buffers.particles, 0,
            this.buffers.read, 0,
            this.buffers.particles.size
        );
        this.device.queue.submit([commandEncoder.finish()]);

        await this.buffers.read.mapAsync(GPUMapMode.READ);
        const particleData = new Float32Array(this.buffers.read.getMappedRange());

        for (let i = 0; i < this.numPixels; i++) {
            const targetX = Math.floor(particleData[i * 8 + 6]);
            const targetY = Math.floor(particleData[i * 8 + 7]);
            const idx = (targetY * this.width + targetX) * 4;

            finalImageData.data[idx] = particleData[i * 8 + 0] * 255;
            finalImageData.data[idx + 1] = particleData[i * 8 + 1] * 255;
            finalImageData.data[idx + 2] = particleData[i * 8 + 2] * 255;
            finalImageData.data[idx + 3] = particleData[i * 8 + 3] * 255;
        }
        
        this.buffers.read.unmap();
        return finalImageData;
    }
}
