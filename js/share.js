/* ========================================
   Kuittiskanneri – Email Share
   Converts receipts to File objects,
   downloads them, and opens mailto: link
   ======================================== */

const ShareUtil = (function () {
    'use strict';

    /**
     * Share receipts via Web Share API
     * @param {Array} receipts - [{ type: 'image', data: base64 } | { type: 'pdf', file: File, name: string }]
     * @param {string} subject - Share title / email subject
     */
    async function shareReceipts(receipts, subject, email) {
        if (!receipts.length) {
            throw new Error('Ei kuitteja lähetettäväksi');
        }

        const files = await buildFileList(receipts);

        // Download all files to the device
        for (let i = 0; i < files.length; i++) {
            downloadFile(files[i]);
            if (i < files.length - 1) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        // Open email compose after a short delay
        await new Promise(r => setTimeout(r, 500));
        const body = 'Liitteenä ' + files.length + (files.length === 1 ? ' kuitti' : ' kuittia') + '.\nLiitä ladatut tiedostot tähän sähköpostiin.';
        const mailto = 'mailto:' + encodeURIComponent(email)
            + '?subject=' + encodeURIComponent(subject)
            + '&body=' + encodeURIComponent(body);
        window.location.href = mailto;
    }

    /**
     * Download a File object to the user's device
     */
    function downloadFile(file) {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        return true;
    }

    return {
        shareReceipts,
        isSupported,
    };
})();
