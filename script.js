/* 
=========================================================
 FIREBASE SETUP INSTRUCTIONS (FOR GITHUB PAGES / WEB)
=========================================================
 Step 1: Create a Firebase project at console.firebase.google.com
 Step 2: Register a Web App inside your Firebase project.
 Step 3: Copy the Firebase configuration object and paste it below.
 Step 4: Enable Authentication -> Sign-in method -> Email/Password.
 Step 5: Create a Realtime Database.
 Step 6: Add the following Realtime Database Security Rules:
 
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}

 Step 7: Add your GitHub Pages domain under Firebase Authentication -> Authorized Domains.
=========================================================
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import {
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
    signOut, sendPasswordResetEmail, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import {
    getDatabase, ref, set, update, remove, onValue, push, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";

// ==========================================
// 1. FIREBASE CONFIGURATION
// ==========================================
// Replace this with your actual Firebase project configuration
const firebaseConfig = {
    apiKey: "AIzaSyBpbMOIhcnzRPYWHizb3oS8yncGrhuKJiE",
    authDomain: "progress-tracker-3100f.firebaseapp.com",
    databaseURL: "https://progress-tracker-3100f-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "progress-tracker-3100f",
    storageBucket: "progress-tracker-3100f.firebasestorage.app",
    messagingSenderId: "1098915150914",
    appId: "1:1098915150914:web:fa7dbadfd022d1c57d81db",
    measurementId: "G-JL6S34RTZP"
};

// Initialize Firebase
let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);
} catch (error) {
    console.error("Firebase Initialization Error:", error);
    // Continue execution so UI can render (will fail on auth/db actions)
}

// ==========================================
// 2. STATE MANAGEMENT
// ==========================================
let currentUser = null;
let allTasksFlat = [];      // Raw data from Firestore
let taskMap = new Map();    // taskId -> task object (with children, progress, etc.)
let rootTasks = [];         // Array of top-level tasks
let currentParentId = null; // null = root, otherwise taskId for breadcrumb navigation
let currentFilter = 'all';  // all, completed, progress
let searchQuery = '';
let unsubscribeTasks = null;
let editingTaskId = null;   // null if creating new, taskId if editing
let deletingTaskId = null;  // For confirmation modal

// ==========================================
// 3. DOM ELEMENTS
// ==========================================
const els = {
    // Layout
    appLoader: document.getElementById('app-loader'),
    authScreen: document.getElementById('auth-screen'),
    appScreen: document.getElementById('app-screen'),

    // Auth Forms
    loginForm: document.getElementById('login-form'),
    signupForm: document.getElementById('signup-form'),
    forgotForm: document.getElementById('forgot-form'),

    // Auth Links
    linkSignup: document.getElementById('link-signup'),
    linkLogin: document.getElementById('link-login'),
    linkForgot: document.getElementById('link-forgot'),
    linkBackLogin: document.getElementById('link-back-login'),

    // User Profile
    userName: document.getElementById('user-name'),
    userEmail: document.getElementById('user-email'),
    userAvatar: document.getElementById('user-avatar'),
    btnLogout: document.getElementById('btn-logout'),
    greeting: document.getElementById('greeting'),

    // UI Controls
    btnThemeToggle: document.getElementById('btn-theme-toggle'),
    btnMobileMenu: document.getElementById('btn-mobile-menu'),
    btnMobileClose: document.getElementById('btn-mobile-close'),
    sidebar: document.getElementById('sidebar'),
    toastContainer: document.getElementById('toast-container'),

    // Dashboard Stats
    statTotal: document.getElementById('stat-total'),
    statCompleted: document.getElementById('stat-completed'),
    statInProgress: document.getElementById('stat-in-progress'),
    statProgressVal: document.getElementById('stat-progress-val'),
    statProgressBar: document.getElementById('stat-progress-bar'),

    // Task List & Controls
    taskList: document.getElementById('task-list'),
    emptyState: document.getElementById('empty-state'),
    breadcrumbs: document.getElementById('breadcrumbs'),
    taskFilter: document.getElementById('task-filter'),
    searchInput: document.getElementById('search-input'),
    btnNewTask: document.getElementById('btn-new-task'),
    btnEmptyCreate: document.getElementById('btn-empty-create'),

    // Modals
    modalOverlay: document.getElementById('modal-overlay'),
    taskModal: document.getElementById('task-modal'),
    taskModalTitle: document.getElementById('task-modal-title'),
    taskForm: document.getElementById('task-form'),
    taskTitleInput: document.getElementById('task-title'),
    taskDescInput: document.getElementById('task-desc'),
    btnCancelTask: document.getElementById('btn-cancel-task'),
    btnCloseTaskModal: document.getElementById('btn-close-task-modal'),

    deleteModal: document.getElementById('delete-modal'),
    btnCancelDelete: document.getElementById('btn-cancel-delete'),
    btnConfirmDelete: document.getElementById('btn-confirm-delete'),
    btnCloseDeleteModal: document.getElementById('btn-close-delete-modal'),
};

// ==========================================
// 4. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupEventListeners();

    if (auth) {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                // Logged in
                currentUser = user;
                updateUserProfileUI();
                showAppScreen();
                subscribeToTasks();
            } else {
                // Logged out
                currentUser = null;
                if (unsubscribeTasks) unsubscribeTasks();
                allTasksFlat = [];
                showAuthScreen();
            }
            els.appLoader.classList.add('hidden');
        });
    } else {
        showToast('Firebase is not configured properly.', 'error');
        els.appLoader.classList.add('hidden');
        showAuthScreen();
    }
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
}

function updateThemeIcon(theme) {
    if (!els.btnThemeToggle) return;
    const icon = els.btnThemeToggle.querySelector('i');
    if (theme === 'dark') {
        icon.className = 'ph ph-sun';
        els.btnThemeToggle.querySelector('span').textContent = 'Light Mode';
    } else {
        icon.className = 'ph ph-moon';
        els.btnThemeToggle.querySelector('span').textContent = 'Dark Mode';
    }
}

// ==========================================
// 5. AUTHENTICATION LOGIC
// ==========================================
function showAuthScreen() {
    els.appScreen.classList.add('hidden');
    els.authScreen.classList.remove('hidden');
    toggleAuthView('login');
}

function showAppScreen() {
    els.authScreen.classList.add('hidden');
    els.appScreen.classList.remove('hidden');
}

function toggleAuthView(view) {
    els.loginForm.classList.add('hidden');
    els.signupForm.classList.add('hidden');
    els.forgotForm.classList.add('hidden');

    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');

    if (view === 'login') {
        els.loginForm.classList.remove('hidden');
        title.textContent = 'Welcome back';
        subtitle.textContent = 'Log in to track your progress.';
    } else if (view === 'signup') {
        els.signupForm.classList.remove('hidden');
        title.textContent = 'Create an account';
        subtitle.textContent = 'Start tracking your goals today.';
    } else if (view === 'forgot') {
        els.forgotForm.classList.remove('hidden');
        title.textContent = 'Reset Password';
        subtitle.textContent = 'Enter your email to receive a reset link.';
    }
}

function getFirebaseErrorMessage(error) {
    const code = error.code;
    if (code === 'auth/invalid-email') return 'Please enter a valid email address.';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Incorrect email or password.';
    if (code === 'auth/email-already-in-use') return 'An account with this email already exists.';
    if (code === 'auth/weak-password') return 'Password should be at least 6 characters.';
    if (code === 'auth/network-request-failed') return 'Network error. Please check your connection.';
    return error.message || 'An unknown error occurred.';
}

function setBtnLoading(btn, isLoading) {
    const spinner = btn.querySelector('.btn-spinner');
    const span = btn.querySelector('span');
    if (isLoading) {
        btn.disabled = true;
        if (spinner) spinner.classList.remove('hidden');
        if (span) span.style.opacity = '0.7';
    } else {
        btn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
        if (span) span.style.opacity = '1';
    }
}

// Auth Event Listeners
els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login');

    setBtnLoading(btn, true);
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        showToast('Logged in successfully', 'success');
    } catch (error) {
        showToast(getFirebaseErrorMessage(error), 'error');
    } finally {
        setBtnLoading(btn, false);
    }
});

els.signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const pass = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    const btn = document.getElementById('btn-signup');

    if (pass !== confirm) {
        showToast('Passwords do not match.', 'warning');
        return;
    }

    setBtnLoading(btn, true);
    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(userCred.user, { displayName: name });
        showToast('Account created successfully', 'success');
        // Will auto-redirect via onAuthStateChanged
    } catch (error) {
        showToast(getFirebaseErrorMessage(error), 'error');
    } finally {
        setBtnLoading(btn, false);
    }
});

els.forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;
    const btn = document.getElementById('btn-forgot');

    setBtnLoading(btn, true);
    try {
        await sendPasswordResetEmail(auth, email);
        showToast('Password reset email sent!', 'success');
        toggleAuthView('login');
    } catch (error) {
        showToast(getFirebaseErrorMessage(error), 'error');
    } finally {
        setBtnLoading(btn, false);
    }
});

els.btnLogout.addEventListener('click', async () => {
    try {
        await signOut(auth);
        showToast('Logged out successfully', 'info');
    } catch (error) {
        showToast('Error logging out', 'error');
    }
});

function updateUserProfileUI() {
    if (!currentUser) return;
    const name = currentUser.displayName || 'User';
    els.userName.textContent = name;
    els.userEmail.textContent = currentUser.email;
    els.userAvatar.textContent = name.substring(0, 2).toUpperCase();

    const firstName = name.split(' ')[0];
    els.greeting.textContent = `Good evening, ${firstName}`;
}

// ==========================================
// 6. FIRESTORE DATA ARCHITECTURE & PROGRESS
// ==========================================

function subscribeToTasks() {
    if (unsubscribeTasks) unsubscribeTasks();
    if (!currentUser || !db) return;

    const tasksRef = ref(db, `users/${currentUser.uid}/tasks`);

    unsubscribeTasks = onValue(tasksRef, (snapshot) => {
        allTasksFlat = [];
        const data = snapshot.val();
        if (data) {
            for (const [id, task] of Object.entries(data)) {
                allTasksFlat.push({ id, ...task });
            }
            // Sort by createdAt since RTDB object keys don't guarantee strict creation order
            allTasksFlat.sort((a, b) => {
                const timeA = a.createdAt || 0;
                const timeB = b.createdAt || 0;
                return timeA - timeB;
            });
        }

        buildTaskTree();
        renderDashboard();
    }, (error) => {
        console.error("Firebase RTDB Subscribe Error:", error);
        if (error.code === 'PERMISSION_DENIED') {
            showToast("Permission denied. Check database security rules.", "error");
        } else {
            showToast("Error loading tasks", "error");
        }
    });
}

function buildTaskTree() {
    taskMap.clear();
    rootTasks = [];

    // First pass: create nodes
    allTasksFlat.forEach(t => {
        const node = { ...t, children: [], progress: 0, leafCount: 0, completedLeafCount: 0 };
        taskMap.set(node.id, node);
    });

    // Second pass: build hierarchy
    allTasksFlat.forEach(t => {
        const node = taskMap.get(t.id);
        if (t.parentId) {
            const parent = taskMap.get(t.parentId);
            if (parent) {
                parent.children.push(node);
            } else {
                // Orphaned task, treat as root to avoid losing data
                rootTasks.push(node);
            }
        } else {
            rootTasks.push(node);
        }
    });

    // Third pass: recursively calculate progress
    /*
     * DERIVED PROGRESS MODEL
     * If a task has children, its progress and completion status is derived entirely 
     * from the ratio of completed descendant leaf tasks.
     * If a task has no children, its status is its own `completed` boolean.
     */
    function calculateProgress(node) {
        if (node.children.length === 0) {
            node.progress = node.completed ? 100 : 0;
            node.leafCount = 1;
            node.completedLeafCount = node.completed ? 1 : 0;
        } else {
            let tLeaves = 0;
            let cLeaves = 0;
            node.children.forEach(child => {
                calculateProgress(child);
                tLeaves += child.leafCount;
                cLeaves += child.completedLeafCount;
            });
            node.progress = tLeaves > 0 ? Math.round((cLeaves / tLeaves) * 100) : 0;
            node.leafCount = tLeaves;
            node.completedLeafCount = cLeaves;
            // Derive completed status
            node.completed = (node.progress === 100);
        }
    }

    rootTasks.forEach(calculateProgress);
}

// ==========================================
// 7. CRUD OPERATIONS
// ==========================================

async function saveTask(title, desc) {
    if (!currentUser || !db) return false;

    try {
        const taskData = {
            title,
            description: desc || '',
            parentId: currentParentId,
            updatedAt: serverTimestamp()
        };

        if (editingTaskId) {
            // Update
            const taskRef = ref(db, `users/${currentUser.uid}/tasks/${editingTaskId}`);
            await update(taskRef, taskData);
            showToast('Task updated', 'success');
        } else {
            // Create
            taskData.completed = false;
            taskData.createdAt = serverTimestamp();
            const newTaskRef = push(ref(db, `users/${currentUser.uid}/tasks`));
            await set(newTaskRef, taskData);
            showToast('Task created', 'success');
        }
        return true;
    } catch (error) {
        console.error(error);
        showToast('Error saving task', 'error');
        return false;
    }
}

async function toggleTaskCompletion(taskId) {
    if (!currentUser || !db) return;
    const node = taskMap.get(taskId);
    if (!node) return;

    const newStatus = !node.completed;
    const idsToUpdate = [];

    // If a task has children, clicking its checkbox checks/unchecks ALL descendant leaves
    function gatherLeaves(n) {
        if (n.children.length === 0) {
            idsToUpdate.push(n.id);
        } else {
            n.children.forEach(gatherLeaves);
        }
    }
    gatherLeaves(node);

    const updates = {};
    idsToUpdate.forEach(id => {
        updates[`users/${currentUser.uid}/tasks/${id}/completed`] = newStatus;
        updates[`users/${currentUser.uid}/tasks/${id}/updatedAt`] = serverTimestamp();
    });

    try {
        await update(ref(db), updates);
        // UI updates automatically via onValue listener
    } catch (error) {
        console.error(error);
        showToast('Error updating task', 'error');
    }
}

async function confirmDeleteTask() {
    if (!currentUser || !db || !deletingTaskId) return;

    const node = taskMap.get(deletingTaskId);
    if (!node) return;

    const btn = document.getElementById('btn-confirm-delete');
    setBtnLoading(btn, true);

    // Find all descendants to delete recursively
    const idsToDelete = [node.id];
    function gatherDescendants(n) {
        n.children.forEach(child => {
            idsToDelete.push(child.id);
            gatherDescendants(child);
        });
    }
    gatherDescendants(node);

    try {
        const updates = {};
        idsToDelete.forEach(id => {
            updates[`users/${currentUser.uid}/tasks/${id}`] = null;
        });

        await update(ref(db), updates);

        showToast('Task and all subtasks deleted', 'success');
        closeModal(els.deleteModal);

        // If we deleted the task we were currently viewing, go up a level
        if (currentParentId && idsToDelete.includes(currentParentId)) {
            currentParentId = null;
            // Better: go to parent of deleted task, but null is safer fallback
        }
    } catch (error) {
        console.error(error);
        showToast('Error deleting task', 'error');
    } finally {
        setBtnLoading(btn, false);
        deletingTaskId = null;
    }
}


// ==========================================
// 8. UI RENDERING
// ==========================================

function renderDashboard() {
    updateSummaryStats();
    updateBreadcrumbs();
    renderTaskList();
}

function updateSummaryStats() {
    let totalTasks = 0;
    let completedTasks = 0;

    // Count ONLY root tasks and direct children for stats, or all nodes? 
    // Usually, tracking all nodes is better for "Total Tasks".
    allTasksFlat.forEach(t => {
        const node = taskMap.get(t.id);
        if (node) {
            totalTasks++;
            if (node.completed) completedTasks++;
        }
    });

    const inProgress = totalTasks - completedTasks;
    const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    els.statTotal.textContent = totalTasks;
    els.statCompleted.textContent = completedTasks;
    els.statInProgress.textContent = inProgress;

    els.statProgressVal.textContent = `${overallProgress}%`;
    els.statProgressBar.style.width = `${overallProgress}%`;
}

function updateBreadcrumbs() {
    els.breadcrumbs.innerHTML = '';

    const rootCrumb = document.createElement('a');
    rootCrumb.href = '#';
    rootCrumb.className = 'breadcrumb-item';
    rootCrumb.textContent = 'My Tasks';
    rootCrumb.onclick = (e) => {
        e.preventDefault();
        currentParentId = null;
        renderDashboard();
    };
    els.breadcrumbs.appendChild(rootCrumb);

    if (currentParentId) {
        const path = [];
        let curr = taskMap.get(currentParentId);
        while (curr) {
            path.unshift(curr);
            curr = curr.parentId ? taskMap.get(curr.parentId) : null;
        }

        path.forEach((node, index) => {
            const separator = document.createElement('i');
            separator.className = 'ph ph-caret-right';
            els.breadcrumbs.appendChild(separator);

            const crumb = document.createElement('a');
            crumb.href = '#';
            crumb.className = 'breadcrumb-item';
            crumb.textContent = node.title;

            if (index < path.length - 1) {
                crumb.onclick = (e) => {
                    e.preventDefault();
                    currentParentId = node.id;
                    renderDashboard();
                };
            }
            els.breadcrumbs.appendChild(crumb);
        });
    }
}

function renderTaskList() {
    els.taskList.innerHTML = '';

    // Get tasks to display based on current view
    let tasksToShow = currentParentId ?
        (taskMap.get(currentParentId)?.children || []) : rootTasks;

    // Apply filters
    if (currentFilter === 'completed') {
        tasksToShow = tasksToShow.filter(t => t.completed);
    } else if (currentFilter === 'progress') {
        tasksToShow = tasksToShow.filter(t => !t.completed);
    }

    // Apply search
    if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        tasksToShow = tasksToShow.filter(t => t.title.toLowerCase().includes(q));
    }

    // Empty state
    if (tasksToShow.length === 0) {
        els.taskList.classList.add('hidden');
        els.emptyState.classList.remove('hidden');

        if (currentParentId || currentFilter !== 'all' || searchQuery !== '') {
            els.emptyState.querySelector('h3').textContent = 'No tasks found';
            els.emptyState.querySelector('p').textContent = 'Try adjusting your filters or search query.';
        } else {
            els.emptyState.querySelector('h3').textContent = 'No tasks yet';
            els.emptyState.querySelector('p').textContent = 'Start by creating your first goal.';
        }
        return;
    }

    els.taskList.classList.remove('hidden');
    els.emptyState.classList.add('hidden');

    // Render Task Cards
    tasksToShow.forEach(task => {
        const card = document.createElement('div');
        card.className = 'task-card';

        const hasChildren = task.children.length > 0;

        card.innerHTML = `
            <div class="task-card-header">
                <div class="task-checkbox-group">
                    <input type="checkbox" class="custom-checkbox" ${task.completed ? 'checked' : ''} data-id="${task.id}">
                    <div class="task-info">
                        <h3 class="task-title ${task.completed ? 'completed' : ''}" data-id="${task.id}">${escapeHtml(task.title)}</h3>
                        ${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}
                    </div>
                </div>
                <div class="task-actions">
                    <button class="btn-icon btn-edit" data-id="${task.id}" title="Edit Task"><i class="ph ph-pencil-simple"></i></button>
                    <button class="btn-icon delete btn-delete" data-id="${task.id}" title="Delete Task"><i class="ph ph-trash"></i></button>
                </div>
            </div>
            
            <div class="task-progress-section">
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${task.progress}%"></div>
                </div>
                <span class="task-meta">${task.progress}%</span>
            </div>
            
            <div class="task-footer">
                <div class="task-dates">
                    ${hasChildren ? `<strong>${task.completedLeafCount} / ${task.leafCount}</strong> subtasks completed` : 'Leaf Task'}
                </div>
                <div class="task-footer-actions">
                    <button class="btn-text btn-add-subtask" data-id="${task.id}">+ Add Subtask</button>
                    <button class="btn-text btn-open" data-id="${task.id}">Open →</button>
                </div>
            </div>
        `;

        els.taskList.appendChild(card);
    });

    attachTaskCardListeners();
}

function attachTaskCardListeners() {
    document.querySelectorAll('.custom-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            toggleTaskCompletion(id);
        });
    });

    document.querySelectorAll('.task-title, .btn-open').forEach(el => {
        el.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            currentParentId = id;
            renderDashboard();
        });
    });

    document.querySelectorAll('.btn-add-subtask').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const parentId = e.target.getAttribute('data-id');
            currentParentId = parentId; // Set context for new task
            openTaskModal(); // Opens for creation
        });
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openTaskModal(id); // Opens for edit
        });
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openDeleteModal(id);
        });
    });
}


// ==========================================
// 9. MODALS & TOASTS
// ==========================================

function openTaskModal(taskId = null) {
    editingTaskId = taskId;
    els.taskForm.reset();

    if (taskId) {
        // Editing existing
        const task = taskMap.get(taskId);
        els.taskModalTitle.textContent = 'Edit Task';
        els.taskTitleInput.value = task.title;
        els.taskDescInput.value = task.description || '';
    } else {
        // Creating new (respects currentParentId)
        els.taskModalTitle.textContent = currentParentId ? 'Add Subtask' : 'Create New Task';
    }

    els.modalOverlay.classList.remove('hidden');
    els.taskModal.classList.remove('hidden');
    els.deleteModal.classList.add('hidden');
    els.taskTitleInput.focus();
}

function openDeleteModal(taskId) {
    deletingTaskId = taskId;
    els.modalOverlay.classList.remove('hidden');
    els.taskModal.classList.add('hidden');
    els.deleteModal.classList.remove('hidden');
}

function closeModal(modalEl) {
    modalEl.classList.add('hidden');
    els.modalOverlay.classList.add('hidden');
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ph-info';
    if (type === 'success') icon = 'ph-check-circle';
    if (type === 'error') icon = 'ph-warning-circle';
    if (type === 'warning') icon = 'ph-warning';

    toast.innerHTML = `<i class="ph ${icon}"></i><span>${escapeHtml(message)}</span>`;

    els.toastContainer.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 3s
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==========================================
// 10. EVENT LISTENERS
// ==========================================

function setupEventListeners() {
    // Auth Links
    els.linkSignup.addEventListener('click', (e) => { e.preventDefault(); toggleAuthView('signup'); });
    els.linkLogin.addEventListener('click', (e) => { e.preventDefault(); toggleAuthView('login'); });
    els.linkForgot.addEventListener('click', (e) => { e.preventDefault(); toggleAuthView('forgot'); });
    els.linkBackLogin.addEventListener('click', (e) => { e.preventDefault(); toggleAuthView('login'); });

    // Top bar actions
    els.btnNewTask.addEventListener('click', () => {
        currentParentId = null; // New top-level task
        openTaskModal();
    });
    els.btnEmptyCreate.addEventListener('click', () => {
        currentParentId = null;
        openTaskModal();
    });

    // Search and Filters
    els.taskFilter.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        renderTaskList();
    });

    els.searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderTaskList(); // Debounce not strictly needed for local filter
    });

    // Modals
    els.btnCancelTask.addEventListener('click', () => closeModal(els.taskModal));
    els.btnCloseTaskModal.addEventListener('click', () => closeModal(els.taskModal));
    els.btnCancelDelete.addEventListener('click', () => closeModal(els.deleteModal));
    els.btnCloseDeleteModal.addEventListener('click', () => closeModal(els.deleteModal));

    // Save Task
    els.taskForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = els.taskTitleInput.value.trim();
        const desc = els.taskDescInput.value.trim();

        if (!title) return;

        const btn = document.getElementById('btn-save-task');
        setBtnLoading(btn, true);
        const success = await saveTask(title, desc);
        setBtnLoading(btn, false);

        if (success) {
            closeModal(els.taskModal);
        }
    });

    // Confirm Delete
    els.btnConfirmDelete.addEventListener('click', confirmDeleteTask);

    // Sidebar Navigation (Simple filtering)
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            const view = item.getAttribute('data-view');
            currentParentId = null; // Reset nested view

            if (view === 'completed') {
                currentFilter = 'completed';
                els.taskFilter.value = 'completed';
            } else {
                currentFilter = 'all';
                els.taskFilter.value = 'all';
            }
            renderDashboard();

            // Close mobile menu if open
            els.sidebar.classList.remove('open');
        });
    });

    // Mobile menu
    els.btnMobileMenu.addEventListener('click', () => {
        els.sidebar.classList.add('open');
    });
    els.btnMobileClose.addEventListener('click', () => {
        els.sidebar.classList.remove('open');
    });

    // Theme toggle
    els.btnThemeToggle.addEventListener('click', toggleTheme);
}

// Utility
function escapeHtml(unsafe) {
    return (unsafe || '').replace(/[&<"']/g, function (m) {
        switch (m) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '"': return '&quot;';
            default: return '&#039;';
        }
    });
}
