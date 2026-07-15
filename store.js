/* ========== DuGuud Shared Store ========== */
/* Products loaded asynchronously via api.js. Cart persisted in localStorage. */

// ─── Auth state ───
let currentUser = null;

async function checkAuth() {
  try {
    if (!isLoggedIn()) { currentUser = null; return; }
    const data = await getMe();
    currentUser = data.user;
  } catch(e) {
    clearToken();
    currentUser = null;
  }
}

// ─── Products (loaded from API) ───
let PRODUCTS = [];

async function loadProducts() {
  try {
    PRODUCTS = await getProducts();
  } catch(e) {
    console.warn('Failed to load products from API:', e.message);
    PRODUCTS = [];
  }
  return PRODUCTS;
}

async function loadProduct(id) {
  try {
    return await getProduct(id);
  } catch(e) {
    console.warn('Failed to load product:', e.message);
    return null;
  }
}

/* ---------------- ICONS ---------------- */
const ICONS = {
  hoodie: `<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M20 10 L12 18 L16 24 L20 20 V54 H44 V20 L48 24 L52 18 L44 10 C40 14 24 14 20 10Z" stroke-linejoin="round"/><circle cx="32" cy="18" r="3"/></svg>`,
  tee: `<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M22 8 L10 16 L16 26 L22 22 V56 H42 V22 L48 26 L54 16 L42 8 C40 12 24 12 22 8Z" stroke-linejoin="round"/></svg>`,
  dress: `<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M26 8 H38 L40 20 L52 54 H12 L24 20 Z" stroke-linejoin="round"/><path d="M26 8 C26 14 38 14 38 8"/></svg>`,
  jeans: `<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M18 8 H46 L48 56 L34 56 L32 30 L30 56 L16 56 Z" stroke-linejoin="round"/></svg>`,
  jacket: `<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M20 10 L8 18 L14 28 L20 22 V54 H44 V22 L50 28 L56 18 L44 10 H36 L32 16 L28 10 Z" stroke-linejoin="round"/></svg>`,
  sneaker: `<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><path d="M6 42 C10 34 16 30 22 30 L30 22 C34 18 40 18 42 22 L46 30 H54 C58 30 58 38 54 40 L48 44 H8 Z" stroke-linejoin="round"/></svg>`,
  flipflop: `<svg viewBox="0 0 64 64" fill="none" stroke-width="2"><ellipse cx="32" cy="44" rx="22" ry="10" stroke-linejoin="round"/><path d="M14 44 C16 36 18 22 30 14 C30 14 34 14 34 14 C46 22 48 36 50 44" stroke-linejoin="round"/><path d="M26 14 L28 42" stroke-linejoin="round"/><path d="M38 14 L36 42" stroke-linejoin="round"/><path d="M20 30 L22 46" stroke-linejoin="round"/><path d="M44 30 L42 46" stroke-linejoin="round"/></svg>`,
};

/* ---------------- CART (persisted to localStorage) ---------------- */
const CART_KEY = 'duguud_cart';
const ORDERS_KEY = 'duguud_orders';
let cart = (()=>{ try { let d=localStorage.getItem(CART_KEY); return d ? JSON.parse(d) : []; } catch(e){ return []; } })();
function saveCart(){ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function loadOrders(){ try { let d=localStorage.getItem(ORDERS_KEY); return d ? JSON.parse(d) : []; } catch(e){ return []; } }
function saveOrders(orders){ localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)); }

/* ---------------- HELPERS ---------------- */
const SHIPPING_FEE = 85;
const FREE_SHIPPING_MIN = 850;

function getShippingFee(subtotal) {
  return subtotal >= FREE_SHIPPING_MIN ? 0 : SHIPPING_FEE;
}

function fmt(n){ return 'R ' + n.toLocaleString('en-ZA', {minimumFractionDigits:2}); }
function stockFlag(stock){
  if(stock === 0) return '<span class="stock-flag out">Sold out</span>';
  if(stock <= 5) return '<span class="stock-flag low">Only ' + stock + ' left</span>';
  return '';
}

/* ---------------- CART ACTIONS ---------------- */
function addToCart(id){
  const product = PRODUCTS.find(p => p.id === id);
  const sizeEl = document.getElementById('size-' + id);
  const qtyEl = document.getElementById('qty-' + id);
  const size = sizeEl ? sizeEl.value : (product.sizes[0] || 'One Size');
  const sizeMax = (product.sizeStock && product.sizeStock[size] !== undefined) ? product.sizeStock[size] : product.stock;
  let qty = qtyEl ? (parseInt(qtyEl.value) || 1) : 1;
  qty = Math.max(1, Math.min(qty, sizeMax));

  const existing = cart.find(c => c.id === id && c.size === size);
  if(existing){
    existing.qty = Math.min(existing.qty + qty, sizeMax);
  } else {
    cart.push({id: product.id, name: product.name, icon: product.icon, images: product.images, price: product.price, size: size, qty: qty});
  }
  saveCart();
  renderCart();
  showToast('Added ' + product.name + ' (' + size + ') to your basket');
}

function renderCart(){
  const wrap = document.getElementById('drawerItems');
  if(!wrap) return;
  const count = cart.reduce(function(sum,c){return sum+c.qty;}, 0);
  const countEl = document.getElementById('cartCount');
  if(countEl) countEl.textContent = count;

  if(cart.length === 0){
    wrap.innerHTML = '<div class="drawer-empty">Your basket is empty.<br>Add something from Clothing to get started.</div>';
  } else {
    wrap.innerHTML = cart.map(function(c,i){
      return '<div class="cart-item">' +
        '<div class="cart-item-media">' + (c.images ? '<img src="' + c.images[0] + '" alt="' + c.name + '" style="width:100%;height:100%;object-fit:cover;">' : ICONS[c.icon]) + '</div>' +
        '<div class="cart-item-info">' +
          '<span class="name">' + c.name + '</span>' +
          '<span class="meta">Size ' + c.size + ' · Qty ' + c.qty + '</span>' +
          '<div class="cart-item-row">' +
            '<span class="price-tag">' + fmt(c.price * c.qty) + '</span>' +
            '<button class="remove-link" onclick="removeFromCart(' + i + ')">Remove</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  const subtotal = cart.reduce(function(sum,c){return sum + c.price*c.qty;}, 0);
  const shipping = getShippingFee(subtotal);
  const total = subtotal + shipping;

  // Update drawer
  const subEl = document.getElementById('subtotalAmt');
  const shipEl = document.getElementById('shippingAmt');
  const totalEl = document.getElementById('drawerTotal');
  if(subEl) subEl.textContent = fmt(subtotal);
  if(shipEl) shipEl.innerHTML = shipping === 0 ? '<span style="color:var(--ok);">FREE</span>' : fmt(shipping);
  if(totalEl) totalEl.textContent = fmt(total);

  // Update checkout modal
  const modSubEl = document.getElementById('modalSubtotal');
  const modShipEl = document.getElementById('modalShipping');
  const modTotalEl = document.getElementById('modalTotal');
  if(modSubEl) modSubEl.textContent = fmt(subtotal);
  if(modShipEl) modShipEl.innerHTML = shipping === 0 ? '<span style="color:var(--ok);">FREE</span>' : fmt(shipping);
  if(modTotalEl) modTotalEl.textContent = fmt(total);

  const cb = document.getElementById('checkoutBtn');
  if(cb) cb.disabled = cart.length === 0;
}

function removeFromCart(i){
  cart.splice(i,1);
  saveCart();
  renderCart();
}

/* ---------------- DRAWER / MODAL ---------------- */
function openCart(){
  const d = document.getElementById('drawer');
  const o = document.getElementById('overlay');
  if(d) d.classList.add('show');
  if(o) o.classList.add('show');
}
function closeCart(){
  const d = document.getElementById('drawer');
  const o = document.getElementById('overlay');
  if(d) d.classList.remove('show');
  if(o) o.classList.remove('show');
}
function closeAll(){ closeCart(); }

function openCheckout(){
  if(cart.length === 0) return;
  const m = document.getElementById('checkoutModal');
  if(m) m.classList.add('show');
}
function closeCheckout(){
  const m = document.getElementById('checkoutModal');
  if(m) m.classList.remove('show');
}

/* ---------------- PLACE ORDER (via API) ---------------- */
async function placeOrder(){
  if(!isLoggedIn()){
    showToast('Please register or log in to place an order');
    return;
  }

  var nameEl = document.querySelector('#checkoutModal input[placeholder="Thandi Nkosi"]');
  var emailEl = document.querySelector('#checkoutModal input[placeholder="you@email.com"]');
  var phoneEl = document.querySelector('#checkoutModal input[placeholder="082 123 4567"]');
  var addrEl = document.querySelector('#checkoutModal input[placeholder="12 Peach Street, Standerton, Mpumalanga"]');
  var cityEl = document.querySelector('#checkoutModal input[placeholder="Standerton"]');
  var postalEl = document.querySelector('#checkoutModal input[placeholder="2430"]');

  var customer = {
    name: nameEl ? nameEl.value : '',
    email: emailEl ? emailEl.value : '',
    phone: phoneEl ? phoneEl.value : '',
    address: addrEl ? addrEl.value : '',
    city: cityEl ? cityEl.value : '',
    postal: postalEl ? postalEl.value : ''
  };

  var subtotal = cart.reduce(function(s,c){ return s + c.price*c.qty; }, 0);
  var shipping = getShippingFee(subtotal);

  try {
    const result = await checkoutWithPayFast({ items: cart, customer, shipping });

    // Close modal and show redirect message
    closeCheckout();
    closeCart();

    // Build and auto-submit PayFast form
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = result.actionUrl;
    form.style.display = 'none';
    for (var key in result.fields) {
      if (result.fields.hasOwnProperty(key)) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = result.fields[key];
        form.appendChild(input);
      }
    }
    document.body.appendChild(form);

    // Clear cart
    cart = [];
    saveCart();
    renderCart();

    showToast('Redirecting to PayFast...');
    form.submit();
  } catch(e) {
    showToast('Checkout failed: ' + e.message);
  }
}

function notifyMe(btn, category){
  const input = btn.previousElementSibling;
  if(!input.value.includes('@')){ input.focus(); return; }
  input.value = '';
  showToast("We'll email you when " + category + ' launches');
}

/* ---------------- TOAST ---------------- */
function showToast(msg){
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMsg');
  if(!toast || !msgEl) return;
  msgEl.textContent = msg;
  toast.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(function(){ toast.classList.remove('show'); }, 2600);
}

/* ---------------- INIT (called by each page) ---------------- */
async function initStore(){
  renderCart();

  const payOpts = document.getElementById('payOptions');
  if(payOpts){
    payOpts.addEventListener('click', function(e){
      const label = e.target.closest('.pay-option');
      if(!label) return;
      payOpts.querySelectorAll('.pay-option').forEach(function(o){ o.classList.remove('selected'); });
      label.classList.add('selected');
      label.querySelector('input').checked = true;
    });
  }

  const overlay = document.getElementById('overlay');
  if(overlay) overlay.addEventListener('click', closeCart);
}
