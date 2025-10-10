struct Particle {
    color: vec4<f32>,
    pos: vec2<f32>,
    target_pos: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> particles_out: array<Particle>;

const SPEED = 0.1;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    let num_particles = arrayLength(&particles);
    if (index >= num_particles) {
        return;
    }

    var p_in = particles[index];
    var p_out = p_in;

    let dir = p_in.target_pos - p_in.pos;
    let dist = length(dir);

    if (dist > 1.0) {
        p_out.pos = p_in.pos + normalize(dir) * SPEED * dist;
    } else {
        p_out.pos = p_in.target_pos;
    }
    
    particles_out[index] = p_out;
}
