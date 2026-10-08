// Product brand resolution.
//
// Brand has to be a stored column rather than something derived on the fly,
// because `name` alone is not reliable: "GUESS Tipped Core Polo Golfer" contains
// the word "Polo" but is a GUESS garment, and RCVA/RVCA are the same label
// spelled two ways. Rules handle the clear majority (and keep working for new
// listings); OVERRIDES pin the cases that rules would get wrong.

// Order matters — the first match wins, so more specific patterns go first.
// "GUESS ... Polo Golfer" must hit GUESS before POLO_LEADING sees the word Polo.
const RULES = [
  { brand: 'New Balance',  re: /\bnew\s*balance\b/i },
  { brand: 'Under Armour', re: /\bunder\s*armour\b/i },
  { brand: "Levi's",       re: /\blevi'?s?\b/i },
  { brand: 'Lee Cooper',   re: /\blee\s*cooper\b/i },
  { brand: 'GUESS',        re: /\bguess\b/i },
  { brand: 'Reebok',       re: /\breebok\b/i },
  { brand: 'Asics',        re: /\basics\b|\bjapan\s*s\b/i },
  { brand: 'Puma',         re: /\bpuma\b|\b9-?t\b|\bsmash\s*3\.?0\b|\bcaven\b|\bst\s*runner\b|\broma\b|\bsuper\s*turino\b|\bturino\b/i },
  { brand: 'Adidas',       re: /\badidas\b|\bvl\s*court\b|\bgrand\s*court\b/i },
  { brand: 'Vans',         re: /\bvans\b/i },
  { brand: 'RVCA',         re: /\brvca\b|\brcva\b/i },   // RCVA is a misspelling of RVCA
  { brand: 'Fila',         re: /\bfila\b/i },
  { brand: 'Fox',          re: /\bfox\b/i },
  { brand: 'Jeep',         re: /\bjeep\b/i },
  { brand: 'Kakiebos',     re: /\bkakiebos\b/i },
  // Leading-word only: "Polo Monogram Flip Flop" is the label, but the word
  // "Polo" appearing mid-name is almost always the garment.
  { brand: 'Polo',         re: /^\s*polo\b/i },
];

// Pinned by product id, for titles the rules cannot resolve. Keep this list
// short — anything here is a judgement call about a specific listing.
const OVERRIDES = {
  // Seeds / legacy rows
  p13: 'Puma', p14: 'Oakley',
};

function guessBrand(name) {
  if (!name) return '';
  for (const rule of RULES) {
    if (rule.re.test(name)) return rule.brand;
  }
  return '';
}

// Returns { brand, source } so callers can report how confident the match is.
// source: 'override' | 'rule' | 'none'
function resolveBrand(product) {
  if (product && OVERRIDES[product.id]) {
    return { brand: OVERRIDES[product.id], source: 'override' };
  }
  const brand = guessBrand((product && product.name) || '');
  return { brand, source: brand ? 'rule' : 'none' };
}

// Canonical spelling for a brand already on a product, so filters don't end up
// with both "RCVA" and "RVCA" as separate options.
function normaliseBrand(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^rcva$/i.test(v)) return 'RVCA';
  for (const rule of RULES) {
    if (rule.brand.toLowerCase() === v.toLowerCase()) return rule.brand;
  }
  return v;
}

module.exports = { RULES, OVERRIDES, guessBrand, resolveBrand, normaliseBrand };
