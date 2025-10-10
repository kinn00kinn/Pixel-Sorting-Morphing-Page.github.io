import { Morph } from './morph.js';

// DOM Elements
const initialImageInput = document.getElementById('initial-image-input');
const targetImageInput = document.getElementById('target-image-input');
const resolutionSlider = document.getElementById('resolution');
const resolutionValue = document.getElementById('resolution-value');
const resolutionValue2 = document.getElementById('resolution-value-2');
const matchingModeSelect = document.getElementById('matching-mode');
const updatePreviewBtn = document.getElementById('update-preview-btn');

const initialCanvas = document.getElementById('initial-image-preview');
const targetCanvas = document.getElementById('target-image-preview');
const staticCanvas = document.getElementById('static-preview');

const loadingAnimationBox = document.getElementById('loading-animation-box');
const gatchankoAnimationContainer = document.getElementById('gatchanko-animation-container');
const gatchankoInitialCanvas = document.getElementById('gatchanko-initial-canvas');
const gatchankoTargetCanvas = document.getElementById('gatchanko-target-canvas');
const nekoPanchImg = document.getElementById('neko-panch-img'); // 猫の画像要素を取得

// State
const state = {
    initialImage: null,
    targetImage: null,
    resolution: 64,
    matchingMode: 'luminance',
};

let morph = null;

// --- Initialization ---
async function initialize() {
    if (!navigator.gpu) {
        alert("WebGPU is not supported on this browser. Please use a modern version of Chrome or Edge.");
        return;
    }
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    
    const shaderCode = await fetch('compute.wgsl').then(res => res.text());
    morph = new Morph(device, shaderCode);

    setupEventListeners();
    updateUI();
}

// --- Event Listeners ---
function setupEventListeners() {
    initialImageInput.addEventListener('change', (e) => handleImageUpload(e, 'initial'));
    targetImageInput.addEventListener('change', (e) => handleImageUpload(e, 'target'));

    resolutionSlider.addEventListener('input', (e) => {
        state.resolution = parseInt(e.target.value);
        updateUI();
        // ▼▼▼ ハイパーパラメータ変更時の自動実行を削除 ▼▼▼
        // if (state.initialImage && state.targetImage) {
        //     generateStaticPreview();
        // }
    });
    matchingModeSelect.addEventListener('change', (e) => {
        state.matchingMode = e.target.value;
        // ▼▼▼ ハイパーパラメータ変更時の自動実行を削除 ▼▼▼
        // if (state.initialImage && state.targetImage) {
        //     generateStaticPreview();
        // }
    });

    // ボタンクリック時にのみアニメーションを実行
    updatePreviewBtn.addEventListener('click', generateStaticPreview);
}

// --- UI Updates ---
function updateUI() {
    resolutionValue.textContent = state.resolution;
    resolutionValue2.textContent = state.resolution;

    updatePreviewBtn.disabled = !(state.initialImage && state.targetImage);
}

// --- Core Functions ---
async function handleImageUpload(event, type) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const img = await createImageBitmap(file);
        const canvas = type === 'initial' ? initialCanvas : targetCanvas;

        if (type === 'initial') {
            state.initialImage = img;
        } else {
            state.targetImage = img;
        }

        drawImageToCanvas(img, canvas);
        updateUI();
        
        // ▼▼▼ 画像アップロード時の自動実行を削除 ▼▼▼
        // if (state.initialImage && state.targetImage) {
        //     await generateStaticPreview();
        // }
    } catch (err) {
        handleError("Failed to load image: " + err.message);
    }
}

function drawImageToCanvas(img, canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        console.error(`Failed to get 2D context for canvas: ${canvas.id}`);
        return;
    }
    canvas.width = state.resolution;
    canvas.height = state.resolution;
    ctx.clearRect(0, 0, canvas.width, canvas.height); // 既存の内容をクリア
    ctx.drawImage(img, 0, 0, state.resolution, state.resolution);
}

async function generateStaticPreview() {
    if (!state.initialImage || !state.targetImage || !morph) return;

    // UIを無効化
    updatePreviewBtn.disabled = true;
    resolutionSlider.disabled = true;
    matchingModeSelect.disabled = true;

    // アニメーションの準備
    gatchankoAnimationContainer.style.display = 'flex';
    drawImageToCanvas(state.initialImage, gatchankoInitialCanvas);
    drawImageToCanvas(state.targetImage, gatchankoTargetCanvas);

    // アニメーション実行
    await runGatchankoAnimation();

    // ローディングアニメーションを表示
    gatchankoAnimationContainer.style.display = 'none';
    loadingAnimationBox.style.display = 'flex';
    staticCanvas.style.display = 'none';

    console.log("Generating static preview...");
    
    // Update canvas dimensions before drawing
    initialCanvas.width = state.resolution;
    initialCanvas.height = state.resolution;
    targetCanvas.width = state.resolution;
    targetCanvas.height = state.resolution;

    const initialCtx = initialCanvas.getContext('2d', { willReadFrequently: true });
    initialCtx.drawImage(state.initialImage, 0, 0, state.resolution, state.resolution);
    const initialImageData = initialCtx.getImageData(0, 0, state.resolution, state.resolution);

    const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true });
    targetCtx.drawImage(state.targetImage, 0, 0, state.resolution, state.resolution);
    const targetImageData = targetCtx.getImageData(0, 0, state.resolution, state.resolution);

    await morph.prepare(initialImageData, targetImageData, state.matchingMode);
    const resultImageData = await morph.getFinalFrame();
    
    staticCanvas.width = state.resolution;
    staticCanvas.height = state.resolution;
    const staticCtx = staticCanvas.getContext('2d', { willReadFrequently: true });
    staticCtx.putImageData(resultImageData, 0, 0);
    console.log("Static preview generated.");

    loadingAnimationBox.style.display = 'none';
    staticCanvas.style.display = 'block';

    // UIを再度有効化
    updatePreviewBtn.disabled = false;
    resolutionSlider.disabled = false;
    matchingModeSelect.disabled = false;
}

async function runGatchankoAnimation() {
    return new Promise(resolve => {
        const initialEl = gatchankoInitialCanvas;
        const targetEl = gatchankoTargetCanvas;
        const punchEl = nekoPanchImg;

        // 1. 初期位置の設定 (画面外)
        initialEl.style.transform = 'translateX(-500%)';
        targetEl.style.transform = 'translateX(500%)';
        punchEl.style.transform = 'translateX(-500%) scale(0.5) rotate(-30deg)';
        punchEl.style.opacity = '0';

        // 2. 画像が画面内へスライド
        setTimeout(() => {
            initialEl.style.transform = 'translateX(-60%)';
            targetEl.style.transform = 'translateX(60%)';
        }, 100);

        // 3. 猫パンチが登場
        setTimeout(() => {
            punchEl.style.opacity = '1';
            punchEl.style.transform = 'translateX(-50%) scale(1) rotate(10deg)';
        }, 500);

        // 4. パンチがヒット！
        setTimeout(() => {
            punchEl.style.transform = 'translateX(0%) scale(1.1) rotate(0deg)';
            // ヒットした衝撃で画像が少し揺れてくっつく
            initialEl.style.transform = 'translateX(-5%) scale(0.95) rotate(-3deg)';
            targetEl.style.transform = 'translateX(5%) scale(0.95) rotate(3deg)';
        }, 800);
        
        // 5. 猫が退場し、画像が中央に収束して消える
        setTimeout(() => {
            punchEl.style.transform = 'translateX(500%) scale(0.6) rotate(30deg)';
            punchEl.style.opacity = '0';
            initialEl.style.transform = 'translateX(0) scale(0)';
            targetEl.style.transform = 'translateX(0) scale(0)';
        }, 1100);

        // 6. アニメーション終了
        setTimeout(() => {
            resolve();
        }, 1600);
    });
}


function handleError(message) {
    console.error(message);
    alert(message);
}

// --- Entry Point ---
document.addEventListener('DOMContentLoaded', initialize);