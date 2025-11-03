// Firebase Configuration
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// PDF.js Configuration
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// DOM Elements
const pdfInput = document.getElementById('pdfInput');
const mainContent = document.getElementById('mainContent');
const pdfContainer = document.getElementById('pdfContainer');
const commentsList = document.getElementById('commentsList');

// Global Variables
let pdfDoc = null;
let comments = [];
let pdfId = null;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragRect = null;
let currentPageWrapper = null;

// Generate unique PDF ID
function generatePDFId(file) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = function() {
            const bytes = new Uint8Array(this.result);
            let hash = 0;
            for (let i = 0; i < Math.min(20, bytes.length); i++) {
                hash = ((hash << 5) - hash) + bytes[i];
                hash |= 0;
            }
            resolve('pdf_' + hash);
        };
        reader.readAsArrayBuffer(file.slice(0, 20));
    });
}

// Load comments from localStorage and Firestore
function loadComments() {
    if (!pdfId) return;
    
    // Load from localStorage
    if (localStorage.getItem('pdfComments_' + pdfId)) {
        const saved = JSON.parse(localStorage.getItem('pdfComments_' + pdfId));
        comments = saved.map(c => { c.highlight = null; return c; });
    } else {
        comments = [];
    }

    // Load from Firestore
    db.collection('pdfComments').doc(pdfId).get().then(doc => {
        if (doc.exists) {
            const shared = doc.data().comments.map(c => { c.highlight = null; return c; });
            comments = [...comments, ...shared.filter(sc => 
                !comments.some(lc => lc.timestamp === sc.timestamp && lc.user === sc.user)
            )];
            renderComments();
        }
    });
}

// Save comments to localStorage and Firestore
function saveComments() {
    if (!pdfId) return;
    
    const commentsToSave = comments.map(c => ({
        user: c.user,
        text: c.text,
        pageNum: c.pageNum,
        highlightPos: c.highlightPos,
        timestamp: c.timestamp
    }));
    
    localStorage.setItem('pdfComments_' + pdfId, JSON.stringify(commentsToSave));
    
    db.collection('pdfComments').doc(pdfId).set({
        comments: commentsToSave
    });
}

// PDF Input Event Listener
pdfInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        return alert('Please select a valid PDF file');
    }
    
    pdfId = await generatePDFId(file);
    loadComments();

    const reader = new FileReader();
    reader.onload = function() {
        const typedarray = new Uint8Array(this.result);
        pdfjsLib.getDocument(typedarray).promise.then(pdf => {
            pdfDoc = pdf;
            document.getElementById('uploadSection').style.display = 'none';
            mainContent.style.display = 'block';
            renderAllPages();
        }).catch(err => alert('Error loading PDF: ' + err));
    };
    reader.readAsArrayBuffer(file);
});

// Render all PDF pages
function renderAllPages() {
    pdfContainer.innerHTML = '';
    const padding = 40;
    const containerWidth = pdfContainer.clientWidth - padding;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        pdfDoc.getPage(pageNum).then(page => {
            const viewport_orig = page.getViewport({ scale: 1 });
            const scale = containerWidth / viewport_orig.width;
            const viewport = page.getViewport({ scale });

            const pageWrapper = document.createElement('div');
            pageWrapper.style.position = 'relative';
            pageWrapper.style.margin = '10px auto';
            pageWrapper.style.width = viewport.width + 'px';
            pdfContainer.appendChild(pageWrapper);
            currentPageWrapper = pageWrapper;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            pageWrapper.appendChild(canvas);
            page.render({ canvasContext: ctx, viewport });

            // Add existing highlights
            comments.filter(c => c.pageNum === pageNum).forEach(c => {
                const highlight = document.createElement('div');
                highlight.className = 'highlight';
                highlight.style.left = c.highlightPos.left + 'px';
                highlight.style.top = c.highlightPos.top + 'px';
                highlight.style.width = c.highlightPos.width + 'px';
                highlight.style.height = c.highlightPos.height + 'px';
                highlight.style.display = 'none';
                pageWrapper.appendChild(highlight);
                c.highlight = highlight;
            });

            // Add event listeners for highlighting
            setupPageEventListeners(pageWrapper, pageNum);
        });
    }
    renderComments();
}

// Setup event listeners for page highlighting
function setupPageEventListeners(pageWrapper, pageNum) {
    pageWrapper.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        isDragging = true;
        dragStart = { x: e.offsetX, y: e.offsetY };
        dragRect = document.createElement('div');
        dragRect.className = 'highlight';
        dragRect.style.left = dragStart.x + 'px';
        dragRect.style.top = dragStart.y + 'px';
        dragRect.style.width = '0px';
        dragRect.style.height = '0px';
        pageWrapper.appendChild(dragRect);
    });

    pageWrapper.addEventListener('mousemove', e => {
        if (!isDragging) return;
        const x = Math.min(e.offsetX, dragStart.x);
        const y = Math.min(e.offsetY, dragStart.y);
        const w = Math.abs(e.offsetX - dragStart.x);
        const h = Math.abs(e.offsetY - dragStart.y);
        dragRect.style.left = x + 'px';
        dragRect.style.top = y + 'px';
        dragRect.style.width = w + 'px';
        dragRect.style.height = h + 'px';
    });

    pageWrapper.addEventListener('mouseup', e => {
        if (!isDragging) return;
        isDragging = false;
        showCommentDialog(pageWrapper, pageNum);
    });
}

// Show comment dialog
function showCommentDialog(pageWrapper, pageNum) {
    const floatingBox = document.createElement('div');
    floatingBox.className = 'floating-comment';
    floatingBox.innerHTML = `
        <span class="close-btn">×</span>
        <input type="text" placeholder="Name" class="comment-input"><br>
        <textarea placeholder="Enter comment" class="comment-textarea"></textarea><br>
        <button id="addCommentBtn">Add Comment</button>
        <button id="aiAnalyzeBtn" style="margin-top:4px;">Analyze with AI</button>
    `;
    document.body.appendChild(floatingBox);

    const closeBtn = floatingBox.querySelector('.close-btn');
    const nameInput = floatingBox.querySelector('input');
    const textInput = floatingBox.querySelector('textarea');
    const addBtn = floatingBox.querySelector('#addCommentBtn');
    const aiBtn = floatingBox.querySelector('#aiAnalyzeBtn');

    closeBtn.addEventListener('click', () => {
        floatingBox.remove();
        dragRect.remove();
        dragRect = null;
    });

    addBtn.addEventListener('click', () => {
        addComment(pageWrapper, pageNum, nameInput.value, textInput.value);
        floatingBox.remove();
        dragRect.remove();
        dragRect = null;
    });

    aiBtn.addEventListener('click', async () => {
        await analyzeWithAI(pageWrapper, pageNum, nameInput.value, floatingBox);
    });
}

// Add comment function
function addComment(pageWrapper, pageNum, userName, commentText) {
    const highlight = document.createElement('div');
    highlight.className = 'highlight';
    highlight.style.left = dragRect.style.left;
    highlight.style.top = dragRect.style.top;
    highlight.style.width = dragRect.style.width;
    highlight.style.height = dragRect.style.height;
    highlight.style.display = 'none';
    pageWrapper.appendChild(highlight);

    const commentObj = {
        user: userName || 'Anonymous',
        text: commentText || '(No text)',
        highlight: highlight,
        pageWrapper: pageWrapper,
        pageNum: pageNum,
        highlightPos: {
            left: parseFloat(dragRect.style.left),
            top: parseFloat(dragRect.style.top),
            width: parseFloat(dragRect.style.width),
            height: parseFloat(dragRect.style.height)
        },
        timestamp: new Date().toLocaleString()
    };
    comments.push(commentObj);
    saveComments();
    renderComments();
}

// AI Analysis function
async function analyzeWithAI(pageWrapper, pageNum, userName, floatingBox) {
    const aiBtn = floatingBox.querySelector('#aiAnalyzeBtn');
    aiBtn.innerText = 'Analyzing...';
    
    try {
        const selectedText = `Text from PDF at page ${pageNum}: ...`; // You would extract text from highlight here
        
        const response = await fetch('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: selectedText })
        });
        
        const data = await response.json();
        const aiCommentObj = {
            user: 'AI Analysis',
            text: data.result || '(No response)',
            highlight: null,
            pageWrapper: pageWrapper,
            pageNum: pageNum,
            highlightPos: null,
            timestamp: new Date().toLocaleString()
        };
        
        comments.push(aiCommentObj);
        saveComments();
        renderComments();
        floatingBox.remove();
        dragRect.remove();
        dragRect = null;
    } catch (err) {
        alert('AI analysis failed: ' + err);
        aiBtn.innerText = 'Analyze with AI';
    }
}

// Render comments in sidebar
function renderComments() {
    commentsList.innerHTML = '';
    
    if (!comments.length) {
        commentsList.innerHTML = '<p class="no-comments">No comments yet</p>';
        return;
    }

    comments.forEach((comment, index) => {
        const commentElement = createCommentElement(comment, index);
        commentsList.appendChild(commentElement);
    });
}

// Create individual comment element
function createCommentElement(comment, index) {
    const div = document.createElement('div');
    div.className = 'comment-item';
    div.innerHTML = `
        <strong>${comment.user}</strong> (${comment.timestamp})<br>
        <span class="comment-text">${comment.text}</span>
        <em>Click to view</em>
    `;

    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '🗑';
    deleteBtn.title = 'Delete Comment';
    
    deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        deleteComment(index);
    });
    
    div.appendChild(deleteBtn);

    div.addEventListener('click', () => {
        highlightComment(comment);
    });

    return div;
}

// Delete comment function
function deleteComment(index) {
    if (comments[index].highlight) {
        comments[index].highlight.remove();
    }
    comments.splice(index, 1);
    saveComments();
    renderComments();
}

// Highlight comment in PDF
function highlightComment(comment) {
    // Hide all other highlights
    comments.forEach(other => {
        if (other !== comment && other.highlight) {
            other.highlight.style.display = 'none';
        }
    });
    
    // Show current highlight
    if (comment.highlight) {
        if (comment.highlight.style.display === 'none') {
            comment.highlight.style.display = 'block';
            comment.highlight.classList.add('active');
            
            // Scroll to highlight
            const containerRect = pdfContainer.getBoundingClientRect();
            const highlightRect = comment.highlight.getBoundingClientRect();
            const offset = highlightRect.top - containerRect.top - containerRect.height / 2 + highlightRect.height / 2;
            pdfContainer.scrollBy({ top: offset, behavior: 'smooth' });
            
            setTimeout(() => comment.highlight.classList.remove('active'), 1500);
        } else {
            comment.highlight.style.display = 'none';
        }
    }
}