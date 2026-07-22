/* ========== DuGuud API Client ========== */
/* Bridges all frontend pages to the Express backend */

const API_BASE = window.location.origin;
const TOKEN_KEY = 'duguud_token';

// ─── Token helpers ───
function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }
function isLoggedIn() { return !!getToken(); }

// ─── Core fetch wrapper ───
async function apiFetch(path, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(API_BASE + path, {
    ...options,
    headers
  });

  let data;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const msg = (data && data.error) ? data.error : 'Request failed (' + res.status + ')';
    throw new Error(msg);
  }

  return data;
}

// ─── Auth ───
async function registerUser({ name, email, phone, password }) {
  return apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, phone, password })
  });
}

async function loginUser({ email, password }) {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

async function getMe() {
  return apiFetch('/api/auth/me');
}

async function changePassword({ currentPassword, newPassword }) {
  return apiFetch('/api/auth/change-password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

async function adminResetPassword({ userId, newPassword }) {
  return apiFetch('/api/auth/reset-password', {
    method: 'PUT',
    body: JSON.stringify({ userId, newPassword })
  });
}

async function getUsers() {
  return apiFetch('/api/auth/users');
}

// ─── Products ───
async function getProducts() {
  const data = await apiFetch('/api/products');
  return data.products || [];
}

/** Admin-only: get all products including cost (hidden from public) */
async function getAdminProducts() {
  const data = await apiFetch('/api/admin/products');
  return data.products || [];
}

async function getProduct(id) {
  const data = await apiFetch('/api/products/' + encodeURIComponent(id));
  return data.product || null;
}

async function createProduct(productData) {
  return apiFetch('/api/products', {
    method: 'POST',
    body: JSON.stringify(productData)
  });
}

async function updateProduct(id, productData) {
  return apiFetch('/api/products/' + encodeURIComponent(id), {
    method: 'PUT',
    body: JSON.stringify(productData)
  });
}

async function deleteProduct(id) {
  return apiFetch('/api/products/' + encodeURIComponent(id), {
    method: 'DELETE'
  });
}

// ─── Orders ───
async function placeOrder({ items, customer }) {
  return apiFetch('/api/orders', {
    method: 'POST',
    body: JSON.stringify({ items, customer })
  });
}

// ─── My Orders (user's own orders) ───
async function getMyOrders() {
  const data = await apiFetch('/api/orders/my');
  return data.orders || [];
}

// ─── PayFast Checkout ───
async function checkoutWithPayFast({ items, customer, shipping, notes }) {
  return apiFetch('/api/checkout', {
    method: 'POST',
    body: JSON.stringify({ items, customer, shipping, notes })
  });
}

async function updateOrderStatus(orderId, status, tracking_number) {
  var body = { status: status };
  if (tracking_number) body.tracking_number = tracking_number;
  return apiFetch('/api/orders/' + encodeURIComponent(orderId) + '/status', {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

async function getOrders() {
  const data = await apiFetch('/api/orders');
  return data.orders || [];
}

// ─── Admin ───
async function seedProducts() {
  return apiFetch('/api/admin/seed', { method: 'POST' });
}

// ─── Newsletter ───
async function subscribeNewsletter(email) {
  return apiFetch('/api/newsletter/subscribe', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
}

async function getNewsletterSubscribers() {
  return apiFetch('/api/newsletter/subscribers');
}

// ─── Contact ───
async function sendContactMessage({ name, email, message }) {
  return apiFetch('/api/contact', {
    method: 'POST',
    body: JSON.stringify({ name, email, message })
  });
}

// ─── Image Upload ───
async function uploadImages(files) {
  const fd = new FormData();
  for (const f of files) {
    fd.append('images', f);
  }
  return apiFetch('/api/upload', {
    method: 'POST',
    body: fd
  });
}
