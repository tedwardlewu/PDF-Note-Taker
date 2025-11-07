const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

const uploadArea = document.getElementById('uploadArea');
const pdfInput = document.getElementById('pdfInput');
const pdfViewer = document.getElementById('pdfViewer');
const noPdfMessage = document.getElementById('noPdfMessage');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageNumElement = document.getElementById('pageNum');
const pageCountElement = document.getElementById('pageCount');
const commentsList = document.getElementById('commentsList');
const commentCount = document.getElementById('commentCount');
const addCommentBtn = document.getElementById('addCommentBtn');
const commentText = document.getElementById('commentText');
const userName = document.getElementById('userName');
const userButtons = document.querySelectorAll('.user-btn');

let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let selectedText = '';
let userRole = 'student';
let comments = JSON.parse(localStorage.getItem('pdfComments')) || [];

// Event listeners
uploadArea.addEventListener('click', () => pdfInput.click());
uploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    uploadArea.style.background = 'rgba(67, 97, 238, 0.1)';
});
uploadArea.addEventListener('dragleave', () => uploadArea.style.background = '');
uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.style.background = '';
    if (e.dataTransfer.files[0]) loadPDF(e.dataTransfer.files[0]);
});
pdfInput.addEventListener('change', e => {
    if (e.target.files[0]) loadPDF(e.target.files[0]);
});

prevPageBtn.addEventListener('click', () => {
        pageNum--;
        queueRenderPage(pageNum);
        renderComments();
    }
});
nextPageBtn.addEventListener('click', () => {
    if (pageNum < pdfDoc.numPages) {
        pageNum++;
        queueRenderPage(pageNum);
        renderComments();
    }
});

userButtons.forEach(btn => btn.addEventListener('click', () => {
    userButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    userRole = btn.dataset.role;
}));

addCommentBtn.addEventListener('click', () => {
    if (!commentText.value.trim() || !selectedText) {
        alert('Please highlight an area and enter a comment.');
        return;
    }

    let highlightedData;
    try {
        highlightedData = JSON.parse(selectedText);
    } catch {
        highlightedData = { type: 'text', text: selectedText };
    }

    comments.push({
        user: userName.value || 'Anonymous',
        role: userRole,
        text: commentText.value,
        highlightedData: highlightedData,
        page: pageNum,
        timestamp: new Date().toISOString()
    });

    commentText.value = '';
    selectedText = '';
    commentText.placeholder = 'Click and drag on PDF to highlight an area, then add your comment here...';
    renderComments();
    saveToLocalStorage();
});

// PDF functions
function loadPDF(file) {
    const reader = new FileReader();
    reader.onload = function() {
        const typedarray = new Uint8Array(this.result);
        pdfjsLib.getDocument(typedarray).promise.then(pdf => {
            pdfDoc = pdf;
            pageCountElement.textContent = pdf.numPages;
            noPdfMessage.style.display = 'none';
            pdfViewer.style.display = 'block';
            queueRenderPage(pageNum);
        }).catch(err => {
            console.error('Error loading PDF:', err);
            alert('Error loading PDF. Please try a different file.');
        });
    };
    reader.readAsArrayBuffer(file);
}

function queueRenderPage(num) {
    if (pageRendering) pageNumPending = num;
    else renderPage(num);
}

function renderPage(num) {
    pageRendering = true;
    pdfDoc.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.cursor = 'crosshair';

        pdfViewer.innerHTML = '';
        pdfViewer.appendChild(canvas);

        page.render({canvasContext: ctx, viewport: viewport}).promise.then(() => {
            pageRendering = false;
            pageNumElement.textContent = num;

            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }

            enableAreaHighlighting(canvas, page, viewport);
            renderComments();
        });
    });
}

function enableAreaHighlighting(canvas, page, viewport) {
    let isDrawing = false;
    let startX, startY;

    // Create highlight layer
    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'highlight-layer';
    highlightLayer.style.left = '0px';
    highlightLayer.style.top = '0px';
    highlightLayer.style.width = canvas.width + 'px';
    highlightLayer.style.height = canvas.height + 'px';
    pdfViewer.appendChild(highlightLayer);

    // Create selection rectangle
    const selectionRect = document.createElement('div');
    selectionRect.className = 'selection-rect';
    selectionRect.style.display = 'none';
    highlightLayer.appendChild(selectionRect);

    // Mouse events
    canvas.onmousedown = (e) => {
        const rect = canvas.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        
        isDrawing = true;
        selectionRect.style.display = 'block';
        selectionRect.style.left = startX + 'px';
        selectionRect.style.top = startY + 'px';
        selectionRect.style.width = '0px';
        selectionRect.style.height = '0px';
    };

    canvas.onmousemove = (e) => {
        if (!isDrawing) return;
        
        const rect = canvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        const width = currentX - startX;
        const height = currentY - startY;
        
        selectionRect.style.width = Math.abs(width) + 'px';
        selectionRect.style.height = Math.abs(height) + 'px';
        selectionRect.style.left = (width < 0 ? currentX : startX) + 'px';
        selectionRect.style.top = (height < 0 ? currentY : startY) + 'px';
    };

    canvas.onmouseup = (e) => {
        if (!isDrawing) return;
        
        isDrawing = false;
        const rect = canvas.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        
        // Only create highlight if area is big enough
        if (Math.abs(endX - startX) > 5 && Math.abs(endY - startY) > 5) {
            createPermanentHighlight(startX, startY, endX, endY, highlightLayer);
            commentText.placeholder = 'Add a comment for this highlighted area...';
            commentText.focus();
        }
        
        selectionRect.style.display = 'none';
    };

    function createPermanentHighlight(x1, y1, x2, y2, layer) {
        const highlight = document.createElement('div');
        highlight.className = 'permanent-highlight';
        highlight.style.left = Math.min(x1, x2) + 'px';
        highlight.style.top = Math.min(y1, y2) + 'px';
        highlight.style.width = Math.abs(x2 - x1) + 'px';
        highlight.style.height = Math.abs(y2 - y1) + 'px';
        
        layer.appendChild(highlight);
        
        // Store highlight coordinates
        selectedText = JSON.stringify({
            type: 'area',
            coords: { x1, y1, x2, y2 },
            page: pageNum
        });
    }
}

function renderComments() {
    commentsList.innerHTML = '';
    const filtered = comments.filter(c => c.page === pageNum);
    
    filtered.forEach((comment, index) => {
        const div = document.createElement('div');
        div.className = `comment ${comment.role === 'professor' ? 'professor' : ''}`;
        
        let highlightText = '';
        if (comment.highlightedData.type === 'area') {
            highlightText = `Area highlight on page ${comment.page}`;
        } else {
            highlightText = `"${comment.highlightedData.text}"`;
        }
        
        div.innerHTML = `
            <div class="comment-header">
                <span><strong>${comment.user}</strong></span>
                <span class="user-type ${comment.role==='professor'?'professor-tag':''}">${comment.role === 'professor' ? 'Professor':'Student'}</span>
            </div>
            <p>${comment.text}</p>
            <p class="highlighted-text">${highlightText}</p>
            <button class="view-highlight-btn" data-index="${index}">View Highlight</button>
        `;
        commentsList.appendChild(div);
    });
    
    // Add event listeners for view highlight buttons
    document.querySelectorAll('.view-highlight-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            const comment = comments.filter(c => c.page === pageNum)[index];
            viewHighlight(comment);
        });
    });
    
    commentCount.textContent = `${filtered.length} comments`;
}

function viewHighlight(comment) {
    if (comment.highlightedData.type === 'area' && comment.page === pageNum) {
        const coords = comment.highlightedData.coords;
        
        // Remove any existing indicators
        const existingIndicators = document.querySelectorAll('.highlight-indicator');
        existingIndicators.forEach(ind => ind.remove());
        
        // Create a temporary indicator
        const indicator = document.createElement('div');
        indicator.className = 'highlight-indicator';
        indicator.style.left = Math.min(coords.x1, coords.x2) + 'px';
        indicator.style.top = Math.min(coords.y1, coords.y2) + 'px';
        indicator.style.width = Math.abs(coords.x2 - coords.x1) + 'px';
        indicator.style.height = Math.abs(coords.y2 - coords.y1) + 'px';
        
        const highlightLayer = document.querySelector('.highlight-layer');
        if (highlightLayer) {
            highlightLayer.appendChild(indicator);
            
            // Remove after 3 seconds
            setTimeout(() => {
                if (indicator.parentNode) {
                    indicator.parentNode.removeChild(indicator);
                }
            }, 3000);
        }
    }
}

function saveToLocalStorage() {
    localStorage.setItem('pdfComments', JSON.stringify(comments));
}

// Initialize comments display
renderComments();