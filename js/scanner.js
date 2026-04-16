/* ========================================
   Kuittiskanneri – OpenCV.js Scanner
   Edge detection, perspective correction,
   interactive corner dragging
   ======================================== */

const Scanner = (function () {
    'use strict';

    let _corners = [];
    let _originalImage = null;
    let _canvas = null;
    let _ctx = null;
    let _draggingIdx = -1;
    let _boundHandlers = {};

    const CORNER_RADIUS = 18;
    const CORNER_COLOR = '#4a9eff';
    const LINE_COLOR = 'rgba(74, 158, 255, 0.6)';
    const LINE_WIDTH = 2;

    // --- Edge Detection ---
    function detectEdges(canvas) {
        const src = cv.imread(canvas);
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const edges = new cv.Mat();
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();

        try {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
            cv.Canny(blurred, edges, 50, 150);

            // Dilate to close gaps
            const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
            cv.dilate(edges, edges, kernel);
            kernel.delete();

            cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

            // Sort contours by area (largest first)
            const sorted = [];
            for (let i = 0; i < contours.size(); i++) {
                const cnt = contours.get(i);
                sorted.push({ idx: i, area: cv.contourArea(cnt) });
            }
            sorted.sort((a, b) => b.area - a.area);

            const imgArea = canvas.width * canvas.height;

            // Find quadrilateral
            for (const item of sorted) {
                // Skip too small contours (< 5% of image)
                if (item.area < imgArea * 0.05) break;

                const cnt = contours.get(item.idx);
                const peri = cv.arcLength(cnt, true);
                const approx = new cv.Mat();
                cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

                if (approx.rows === 4) {
                    const pts = [];
                    for (let j = 0; j < 4; j++) {
                        pts.push({
                            x: approx.data32S[j * 2],
                            y: approx.data32S[j * 2 + 1],
                        });
                    }
                    approx.delete();
                    // Convert to axis-aligned bounding rectangle
                    const minX = Math.min(...pts.map(p => p.x));
                    const minY = Math.min(...pts.map(p => p.y));
                    const maxX = Math.max(...pts.map(p => p.x));
                    const maxY = Math.max(...pts.map(p => p.y));
                    return [
                        { x: minX, y: minY },
                        { x: maxX, y: minY },
                        { x: maxX, y: maxY },
                        { x: minX, y: maxY },
                    ];
                }
                approx.delete();
            }
        } finally {
            src.delete();
            gray.delete();
            blurred.delete();
            edges.delete();
            contours.delete();
            hierarchy.delete();
        }

        // Fallback: use image corners with margin
        const m = Math.round(Math.min(canvas.width, canvas.height) * 0.05);
        return [
            { x: m, y: m },
            { x: canvas.width - m, y: m },
            { x: canvas.width - m, y: canvas.height - m },
            { x: m, y: canvas.height - m },
        ];
    }

    // Order corners: top-left, top-right, bottom-right, bottom-left
    function orderCorners(pts) {
        const sorted = [...pts];
        // sum = x + y  → smallest = TL, largest = BR
        // diff = y - x → smallest = TR, largest = BL
        sorted.sort((a, b) => (a.x + a.y) - (b.x + b.y));
        const tl = sorted[0];
        const br = sorted[3];

        sorted.sort((a, b) => (a.y - a.x) - (b.y - b.x));
        const tr = sorted[0];
        const bl = sorted[3];

        return [tl, tr, br, bl];
    }

    // --- Rectangular Crop ---
    function cropReceipt(originalImage, canvas, corners) {
        const scaleX = originalImage.naturalWidth / canvas.width;
        const scaleY = originalImage.naturalHeight / canvas.height;

        const xs = corners.map(c => c.x);
        const ys = corners.map(c => c.y);
        const srcX = Math.round(Math.min(...xs) * scaleX);
        const srcY = Math.round(Math.min(...ys) * scaleY);
        const srcW = Math.round((Math.max(...xs) - Math.min(...xs)) * scaleX);
        const srcH = Math.round((Math.max(...ys) - Math.min(...ys)) * scaleY);

        if (srcW < 1 || srcH < 1) return null;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = srcW;
        outCanvas.height = srcH;
        const ctx = outCanvas.getContext('2d');
        ctx.drawImage(originalImage, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

        return outCanvas.toDataURL('image/jpeg', 0.8);
    }

    function dist(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    // --- Interactive Corner Dragging ---
    function initCornerDrag(canvas, corners, originalImage) {
        cleanup();

        _canvas = canvas;
        _ctx = canvas.getContext('2d');
        _corners = corners.map((c) => ({ ...c }));
        _originalImage = originalImage;
        _draggingIdx = -1;

        drawOverlay();

        // Bind events
        _boundHandlers = {
            touchstart: onPointerDown.bind(null, true),
            touchmove: onPointerMove.bind(null, true),
            touchend: onPointerUp,
            mousedown: onPointerDown.bind(null, false),
            mousemove: onPointerMove.bind(null, false),
            mouseup: onPointerUp,
        };

        canvas.addEventListener('touchstart', _boundHandlers.touchstart, { passive: false });
        canvas.addEventListener('touchmove', _boundHandlers.touchmove, { passive: false });
        canvas.addEventListener('touchend', _boundHandlers.touchend);
        canvas.addEventListener('mousedown', _boundHandlers.mousedown);
        canvas.addEventListener('mousemove', _boundHandlers.mousemove);
        canvas.addEventListener('mouseup', _boundHandlers.mouseup);
    }

    function getCanvasCoords(canvas, clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
        };
    }

    function onPointerDown(isTouch, e) {
        e.preventDefault();
        const pos = isTouch
            ? getCanvasCoords(_canvas, e.touches[0].clientX, e.touches[0].clientY)
            : getCanvasCoords(_canvas, e.clientX, e.clientY);

        // Find nearest corner within threshold
        const threshold = Math.min(_canvas.width, _canvas.height) * 0.08;
        let minDist = Infinity;
        let minIdx = -1;

        _corners.forEach((c, i) => {
            const d = dist(c, pos);
            if (d < minDist) {
                minDist = d;
                minIdx = i;
            }
        });

        if (minDist < threshold) {
            _draggingIdx = minIdx;
        }
    }

    function onPointerMove(isTouch, e) {
        if (_draggingIdx < 0) return;
        e.preventDefault();

        const pos = isTouch
            ? getCanvasCoords(_canvas, e.touches[0].clientX, e.touches[0].clientY)
            : getCanvasCoords(_canvas, e.clientX, e.clientY);

        // Clamp to canvas bounds
        const x = Math.max(0, Math.min(_canvas.width, pos.x));
        const y = Math.max(0, Math.min(_canvas.height, pos.y));

        // Maintain rectangle shape: update adjacent corners
        switch (_draggingIdx) {
            case 0: // Top-left
                _corners[0].x = x; _corners[0].y = y;
                _corners[1].y = y;
                _corners[3].x = x;
                break;
            case 1: // Top-right
                _corners[1].x = x; _corners[1].y = y;
                _corners[0].y = y;
                _corners[2].x = x;
                break;
            case 2: // Bottom-right
                _corners[2].x = x; _corners[2].y = y;
                _corners[1].x = x;
                _corners[3].y = y;
                break;
            case 3: // Bottom-left
                _corners[3].x = x; _corners[3].y = y;
                _corners[0].x = x;
                _corners[2].y = y;
                break;
        }

        drawOverlay();
    }

    function onPointerUp() {
        _draggingIdx = -1;
    }

    function drawOverlay() {
        if (!_ctx || !_canvas) return;

        // Redraw original image
        _ctx.drawImage(_originalImage, 0, 0, _canvas.width, _canvas.height);

        if (_corners.length !== 4) return;

        // Semi-transparent overlay outside the selection
        _ctx.save();
        _ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        _ctx.fillRect(0, 0, _canvas.width, _canvas.height);

        // Cut out the selection area
        _ctx.globalCompositeOperation = 'destination-out';
        _ctx.beginPath();
        _ctx.moveTo(_corners[0].x, _corners[0].y);
        for (let i = 1; i < 4; i++) {
            _ctx.lineTo(_corners[i].x, _corners[i].y);
        }
        _ctx.closePath();
        _ctx.fill();
        _ctx.restore();

        // Draw selection lines
        _ctx.strokeStyle = LINE_COLOR;
        _ctx.lineWidth = LINE_WIDTH;
        _ctx.beginPath();
        _ctx.moveTo(_corners[0].x, _corners[0].y);
        for (let i = 1; i < 4; i++) {
            _ctx.lineTo(_corners[i].x, _corners[i].y);
        }
        _ctx.closePath();
        _ctx.stroke();

        // Draw corner handles
        _corners.forEach((c) => {
            _ctx.beginPath();
            _ctx.arc(c.x, c.y, CORNER_RADIUS, 0, Math.PI * 2);
            _ctx.fillStyle = CORNER_COLOR;
            _ctx.fill();
            _ctx.strokeStyle = '#fff';
            _ctx.lineWidth = 2;
            _ctx.stroke();
        });
    }

    function getCurrentCorners() {
        return _corners.map((c) => ({ ...c }));
    }

    function cleanup() {
        if (_canvas && _boundHandlers.touchstart) {
            _canvas.removeEventListener('touchstart', _boundHandlers.touchstart);
            _canvas.removeEventListener('touchmove', _boundHandlers.touchmove);
            _canvas.removeEventListener('touchend', _boundHandlers.touchend);
            _canvas.removeEventListener('mousedown', _boundHandlers.mousedown);
            _canvas.removeEventListener('mousemove', _boundHandlers.mousemove);
            _canvas.removeEventListener('mouseup', _boundHandlers.mouseup);
        }
        _boundHandlers = {};
        _corners = [];
        _originalImage = null;
        _draggingIdx = -1;
    }

    return {
        detectEdges,
        cropReceipt,
        initCornerDrag,
        getCurrentCorners,
        cleanup,
    };
})();
