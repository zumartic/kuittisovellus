/* ========================================
   Kuittiskanneri – Main Application Logic
   ======================================== */

(function () {
    'use strict';

    // --- State ---
    const state = {
        receipts: [],           // { type: 'image'|'pdf', data?: string, file?: File, name?: string }
        pendingFiles: [],       // image Files waiting for crop processing
        currentOriginalImage: null, // HTMLImageElement for crop view
    };

    // --- DOM refs ---
    const $ = (sel) => document.querySelector(sel);
    const views = {
        list: $('#view-list'),
        crop: $('#view-crop'),
        share: $('#view-share'),
    };
    const els = {
        loadingOverlay: $('#loading-overlay'),
        loadingText: $('#loading-text'),
        processingOverlay: $('#processing-overlay'),
        settingsPanel: $('#settings-panel'),
        emailInput: $('#email-input'),
        receiptCount: $('#receipt-count'),
        countText: $('#count-text'),
        receiptGrid: $('#receipt-grid'),
        emptyState: $('#empty-state'),
        btnSettings: $('#btn-settings'),
        btnCamera: $('#btn-camera'),
        btnFile: $('#btn-file'),
        btnSend: $('#btn-send'),
        cameraInput: $('#camera-input'),
        fileInput: $('#file-input'),
        cropCanvas: $('#crop-canvas'),
        btnCropBack: $('#btn-crop-back'),
        btnCropRetry: $('#btn-crop-retry'),
        btnCropAccept: $('#btn-crop-accept'),
        shareEmail: $('#share-email'),
        shareSubject: $('#share-subject'),
        shareFileCount: $('#share-file-count'),
        sharePreviewGrid: $('#share-preview-grid'),
        btnShareBack: $('#btn-share-back'),
        btnShareSend: $('#btn-share-send'),
        toast: $('#toast'),
    };

    // --- Init ---
    function init() {
        loadSettings();
        bindEvents();
        registerServiceWorker();
        waitForOpenCV();
    }

    // --- Service Worker ---
    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        }
    }

    // --- OpenCV loading ---
    function waitForOpenCV() {
        // OpenCV.js uses Module.onRuntimeInitialized
        if (typeof cv !== 'undefined' && cv.Mat) {
            onOpenCVReady();
            return;
        }

        window.Module = window.Module || {};
        const originalOnInit = window.Module.onRuntimeInitialized;
        window.Module.onRuntimeInitialized = function () {
            if (originalOnInit) originalOnInit();
            onOpenCVReady();
        };

        // Also handle the promise-based cv
        const checkCV = setInterval(() => {
            if (typeof cv !== 'undefined') {
                if (cv instanceof Promise) {
                    cv.then(() => {
                        clearInterval(checkCV);
                        onOpenCVReady();
                    });
                } else if (cv.Mat) {
                    clearInterval(checkCV);
                    onOpenCVReady();
                }
            }
        }, 500);

        // Timeout fallback – allow using app without OpenCV
        setTimeout(() => {
            clearInterval(checkCV);
            if (!window._opencvReady) {
                els.loadingText.textContent = 'OpenCV.js ei latautunut – rajaus ei käytettävissä';
                setTimeout(() => hideLoading(), 1500);
                window._opencvReady = false;
            }
        }, 30000);
    }

    function onOpenCVReady() {
        window._opencvReady = true;
        hideLoading();
    }

    function hideLoading() {
        els.loadingOverlay.classList.add('hidden');
    }

    // --- Settings / localStorage ---
    function loadSettings() {
        const email = localStorage.getItem('receipt_app_email') || '';
        els.emailInput.value = email;
    }

    function saveEmail() {
        const val = els.emailInput.value.trim();
        localStorage.setItem('receipt_app_email', val);
    }

    // --- View switching ---
    function switchView(name) {
        Object.values(views).forEach((v) => v.classList.add('hidden'));
        views[name].classList.remove('hidden');
    }

    // --- Events ---
    function bindEvents() {
        // Settings toggle
        els.btnSettings.addEventListener('click', () => {
            els.settingsPanel.classList.toggle('hidden');
        });

        // Save email on change
        els.emailInput.addEventListener('input', saveEmail);

        // Camera button
        els.btnCamera.addEventListener('click', () => els.cameraInput.click());
        els.cameraInput.addEventListener('change', handleCameraInput);

        // File button
        els.btnFile.addEventListener('click', () => els.fileInput.click());
        els.fileInput.addEventListener('change', handleFileInput);

        // Send button → share view
        els.btnSend.addEventListener('click', openShareView);

        // Crop view
        els.btnCropBack.addEventListener('click', () => {
            state.pendingFiles = [];
            if (typeof Scanner !== 'undefined') Scanner.cleanup();
            switchView('list');
        });
        els.btnCropRetry.addEventListener('click', () => {
            if (typeof Scanner !== 'undefined') Scanner.cleanup();
            switchView('list');
            els.cameraInput.click();
        });
        els.btnCropAccept.addEventListener('click', acceptCrop);

        // Share view
        els.btnShareBack.addEventListener('click', () => switchView('list'));
        els.btnShareSend.addEventListener('click', handleShare);
    }

    // --- Camera input ---
    function handleCameraInput(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        processImageFile(file);
    }

    // --- File input (multi, images + PDF) ---
    function handleFileInput(e) {
        const files = Array.from(e.target.files);
        e.target.value = '';
        if (!files.length) return;

        const pdfs = files.filter((f) => f.type === 'application/pdf');
        const images = files.filter((f) => f.type.startsWith('image/'));

        // PDFs go directly to the list
        pdfs.forEach((f) => {
            state.receipts.push({ type: 'pdf', file: f, name: f.name });
        });

        if (pdfs.length) renderReceiptList();

        // Images: queue for cropping one by one
        if (images.length) {
            state.pendingFiles = images.slice(1);
            processImageFile(images[0]);
        }
    }

    // --- Process single image file → crop view ---
    function processImageFile(file) {
        const img = new Image();
        img.onload = () => {
            state.currentOriginalImage = img;
            URL.revokeObjectURL(img.src);
            openCropView(img);
        };
        img.src = URL.createObjectURL(file);
    }

    // --- Crop view ---
    function openCropView(img) {
        switchView('crop');

        const canvas = els.cropCanvas;
        const maxW = 2000;
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        if (w > maxW) {
            h = Math.round(h * (maxW / w));
            w = maxW;
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Try OpenCV edge detection
        if (window._opencvReady && typeof Scanner !== 'undefined') {
            els.processingOverlay.classList.remove('hidden');
            // Use requestAnimationFrame to let the overlay render first
            requestAnimationFrame(() => {
                setTimeout(() => {
                    const corners = Scanner.detectEdges(canvas);
                    Scanner.initCornerDrag(canvas, corners, img);
                    els.processingOverlay.classList.add('hidden');
                }, 50);
            });
        } else {
            // No OpenCV – use full image corners as default
            const defaultCorners = [
                { x: 0, y: 0 },
                { x: w, y: 0 },
                { x: w, y: h },
                { x: 0, y: h },
            ];
            if (typeof Scanner !== 'undefined') {
                Scanner.initCornerDrag(canvas, defaultCorners, img);
            }
        }
    }

    // --- Accept crop ---
    function acceptCrop() {
        const canvas = els.cropCanvas;

        let croppedDataUrl;

        if (typeof Scanner !== 'undefined' && Scanner.getCurrentCorners) {
            const corners = Scanner.getCurrentCorners();
            if (window._opencvReady) {
                croppedDataUrl = Scanner.cropReceipt(
                    state.currentOriginalImage,
                    canvas,
                    corners
                );
            }
        }

        if (!croppedDataUrl) {
            // Fallback: use canvas as-is
            croppedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
        }

        state.receipts.push({ type: 'image', data: croppedDataUrl });
        if (typeof Scanner !== 'undefined') Scanner.cleanup();
        state.currentOriginalImage = null;

        // Process next pending image if any
        if (state.pendingFiles.length > 0) {
            const next = state.pendingFiles.shift();
            processImageFile(next);
        } else {
            switchView('list');
            renderReceiptList();
        }
    }

    // --- Render receipt list ---
    function renderReceiptList() {
        const grid = els.receiptGrid;
        grid.innerHTML = '';

        state.receipts.forEach((receipt, idx) => {
            const item = document.createElement('div');
            item.className = 'receipt-item';

            if (receipt.type === 'image') {
                const img = document.createElement('img');
                img.src = receipt.data;
                img.alt = 'Kuitti ' + (idx + 1);
                item.appendChild(img);
            } else {
                const thumb = document.createElement('div');
                thumb.className = 'pdf-thumb';
                thumb.innerHTML = `
                    <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 4h14l10 10v28a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
                        <polyline points="28 4 28 14 38 14"/>
                        <text x="16" y="33" fill="currentColor" stroke="none" font-size="10" font-weight="bold">PDF</text>
                    </svg>
                    <span class="pdf-name">${escapeHtml(receipt.name)}</span>
                `;
                item.appendChild(thumb);
            }

            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn-remove';
            removeBtn.textContent = '×';
            removeBtn.setAttribute('aria-label', 'Poista');
            removeBtn.addEventListener('click', () => removeReceipt(idx));
            item.appendChild(removeBtn);

            grid.appendChild(item);
        });

        updateListUI();
    }

    function updateListUI() {
        const count = state.receipts.length;
        els.emptyState.classList.toggle('hidden', count > 0);
        els.receiptCount.classList.toggle('hidden', count === 0);
        els.receiptGrid.classList.toggle('hidden', count === 0);
        els.countText.textContent = count + (count === 1 ? ' kuitti' : ' kuittia');
        els.btnSend.disabled = count === 0;
    }

    function removeReceipt(idx) {
        state.receipts.splice(idx, 1);
        renderReceiptList();
    }

    // --- Share view ---
    function openShareView() {
        if (state.receipts.length === 0) return;

        switchView('share');

        // Populate email
        els.shareEmail.value = localStorage.getItem('receipt_app_email') || '';

        // Default subject
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        els.shareSubject.value = `Kuitit ${dd}.${mm}.${yyyy}`;

        // File count
        els.shareFileCount.textContent = `(${state.receipts.length})`;

        // Preview grid
        const grid = els.sharePreviewGrid;
        grid.innerHTML = '';
        state.receipts.forEach((receipt, idx) => {
            const item = document.createElement('div');
            item.className = 'receipt-item';
            if (receipt.type === 'image') {
                const img = document.createElement('img');
                img.src = receipt.data;
                img.alt = 'Kuitti ' + (idx + 1);
                item.appendChild(img);
            } else {
                const thumb = document.createElement('div');
                thumb.className = 'pdf-thumb';
                thumb.innerHTML = `
                    <svg viewBox="0 0 48 48" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 4h14l10 10v28a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
                        <polyline points="28 4 28 14 38 14"/>
                        <text x="16" y="33" fill="currentColor" stroke="none" font-size="10" font-weight="bold">PDF</text>
                    </svg>
                    <span class="pdf-name">${escapeHtml(receipt.name)}</span>
                `;
                item.appendChild(thumb);
            }
            grid.appendChild(item);
        });
    }

    // --- Handle share ---
    async function handleShare() {
        const subject = els.shareSubject.value.trim() || 'Kuitit';

        try {
            await ShareUtil.shareReceipts(state.receipts, subject);
            showToast('Jaettu onnistuneesti!', 'success');
            // Clear after successful share
            state.receipts = [];
            switchView('list');
            renderReceiptList();
        } catch (err) {
            if (err.name === 'AbortError') {
                // User cancelled share – do nothing
                return;
            }
            showToast(err.message || 'Jakaminen epäonnistui', 'error');
        }
    }

    // --- Toast ---
    let toastTimer = null;
    function showToast(msg, type) {
        els.toast.textContent = msg;
        els.toast.className = 'toast ' + (type || '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            els.toast.classList.add('hidden');
        }, 3000);
    }

    // --- Utils ---
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // --- Expose for scanner.js ---
    window.App = {
        showToast,
    };

    // --- Start ---
    init();
    // Initial render
    renderReceiptList();
})();
