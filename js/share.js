/* ========================================
   Kuittiskanneri – Web Share API
   Converts receipts to File objects and
   shares via navigator.share()
   ======================================== */

const ShareUtil = (function () {
    'use strict';

    /**
     * Share receipts via Web Share API
     * @param {Array} receipts - [{ type: 'image', data: base64 } | { type: 'pdf', file: File, name: string }]
     * @param {string} subject - Share title / email subject
     */
    async function shareReceipts(receipts, subject) {
        if (!receipts.length) {
            throw new Error('Ei kuitteja jaettavaksi');
        }

        const files = await buildFileList(receipts);

        // Check Web Share API support
        if (!navigator.canShare) {
            throw new Error('Selaimesi ei tue tiedostojen jakamista. Kokeile Chrome- tai Safari-mobiiliselainta.');
        }

        const shareData = {
            title: subject,
            text: '',
            files: files,
        };

        if (!navigator.canShare(shareData)) {
            throw new Error('Selaimesi ei pysty jakamaan näitä tiedostoja.');
        }

        await navigator.share(shareData);
    }

    /**
     * Convert receipts array to File objects
     */
    async function buildFileList(receipts) {
        const files = [];
        let imgIdx = 1;
        let pdfIdx = 1;

        for (const receipt of receipts) {
            if (receipt.type === 'image') {
                const blob = await dataUrlToBlob(receipt.data);
                const fileName = `kuitti_${imgIdx}.jpg`;
                files.push(new File([blob], fileName, { type: 'image/jpeg' }));
                imgIdx++;
            } else if (receipt.type === 'pdf') {
                const fileName = receipt.name || `kuitti_${pdfIdx}.pdf`;
                // Re-wrap into a new File to ensure clean name
                files.push(new File([receipt.file], fileName, { type: 'application/pdf' }));
                pdfIdx++;
            }
        }

        return files;
    }

    /**
     * Convert data URL to Blob
     */
    async function dataUrlToBlob(dataUrl) {
        const res = await fetch(dataUrl);
        return res.blob();
    }

    /**
     * Check if Web Share with files is supported
     */
    function isSupported() {
        return !!(navigator.canShare && navigator.share);
    }

    return {
        shareReceipts,
        isSupported,
    };
})();
