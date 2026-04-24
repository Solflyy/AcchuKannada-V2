/**
 * Run: node scripts/compute-filters.js
 * Generates assets/filters-free.json and assets/filters-pro.json
 * with pre-computed color matrices so filters can be renamed/tweaked
 * from JSON without rebuilding the app.
 */
const fs = require('fs');
const path = require('path');

const IDENTITY = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];

// 4x5 color matrix multiply (same logic as concatColorMatrices)
function multiply(a, b) {
  const out = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[row * 5 + k] * b[k * 5 + col];
      }
      if (col === 4) sum += a[row * 5 + 4];
      out[row * 5 + col] = col === 4 ? sum : sum;
    }
  }
  // fix translation column
  const r = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[row*5+k] * b[k*5+col];
      r[row*5+col] = v;
    }
    // translation
    let t = a[row*5+4];
    for (let k = 0; k < 4; k++) t += a[row*5+k] * b[k*5+4];
    r[row*5+4] = t;
  }
  return r;
}

function buildFilter(...matrices) {
  if (matrices.length === 0) return [...IDENTITY];
  let result = matrices[0];
  for (let i = 1; i < matrices.length; i++) result = multiply(result, matrices[i]);
  return result.map(v => Math.round(v * 100000) / 100000);
}

// ── FREE FILTERS ──
const FREE = [
  { id: 'none', label: 'Original', previewColor: 'transparent', defaultStrength: 0, matrix: [...IDENTITY] },

  // Kodak Gold
  { id: 'kg1', label: 'KG1', previewColor: '#D4A832', defaultStrength: 1.0, matrix: buildFilter(
    [1.14,0.06,-0.04,0,0.03, 0.03,1.08,-0.01,0,0.02, -0.06,0.0,0.86,0,0.04, 0,0,0,1,0],
    [0.96,0,0,0,0.04, 0,0.96,0,0,0.03, 0,0,0.94,0,0.03, 0,0,0,1,0],
  )},
  { id: 'kg2', label: 'KG2', previewColor: '#C8915A', defaultStrength: 1.0, matrix: buildFilter(
    [1.20,0.08,-0.06,0,0.04, 0.05,1.10,-0.02,0,0.03, -0.08,-0.02,0.80,0,0.06, 0,0,0,1,0],
    [1.06,0,0,0,-0.02, 0,1.06,0,0,-0.01, 0,0,1.04,0,0.0, 0,0,0,1,0],
    [0.96,0.02,0.02,0,0.0, 0.02,0.96,0.02,0,0.0, 0.02,0.02,0.96,0,0.0, 0,0,0,1,0],
  )},

  // Fujifilm Superia
  { id: 'fs1', label: 'FS1', previewColor: '#3A8050', defaultStrength: 1.0, matrix: buildFilter(
    [1.04,-0.02,0.0,0,0.0, -0.02,1.14,-0.02,0,-0.01, 0.0,-0.02,1.10,0,0.02, 0,0,0,1,0],
    [0.98,0,0,0,0.02, 0,0.98,0,0,0.02, 0,0,0.98,0,0.03, 0,0,0,1,0],
  )},
  { id: 'fs4', label: 'FS4', previewColor: '#2D7080', defaultStrength: 1.0, matrix: buildFilter(
    [1.10,-0.04,0.02,0,-0.02, -0.02,1.18,-0.04,0,-0.02, 0.02,-0.04,1.16,0,-0.01, 0,0,0,1,0],
    [1.08,0,0,0,-0.04, 0,1.08,0,0,-0.04, 0,0,1.08,0,-0.04, 0,0,0,1,0],
  )},
  { id: 'fs16', label: 'FS16', previewColor: '#508060', defaultStrength: 1.0, matrix: buildFilter(
    [1.02,0.04,0.02,0,0.03, 0.02,1.06,0.02,0,0.03, 0.0,0.02,1.04,0,0.04, 0,0,0,1,0],
    [0.90,0.04,0.02,0,0.06, 0.03,0.90,0.03,0,0.06, 0.02,0.04,0.90,0,0.07, 0,0,0,1,0],
  )},

  // Agfa
  { id: 'av4', label: 'AV4', previewColor: '#D49020', defaultStrength: 1.0, matrix: buildFilter(
    [1.18,0.08,-0.06,0,0.03, 0.04,1.12,-0.02,0,0.02, -0.08,-0.04,0.82,0,0.05, 0,0,0,1,0],
    [0.94,0,0,0,0.05, 0,0.94,0,0,0.04, 0,0,0.92,0,0.04, 0,0,0,1,0],
  )},
  { id: 'av8', label: 'AV8', previewColor: '#C07050', defaultStrength: 1.0, matrix: buildFilter(
    [1.12,0.10,-0.04,0,0.06, 0.06,1.06,0.02,0,0.05, -0.06,0.0,0.80,0,0.08, 0,0,0,1,0],
    [0.88,0.04,0.02,0,0.08, 0.03,0.88,0.03,0,0.08, 0.02,0.04,0.88,0,0.10, 0,0,0,1,0],
  )},
  { id: 'av5', label: 'AU5', previewColor: '#B85040', defaultStrength: 1.0, matrix: buildFilter(
    [1.24,-0.04,0.02,0,-0.02, -0.02,1.20,-0.02,0,-0.03, 0.02,-0.04,1.22,0,-0.04, 0,0,0,1,0],
    [1.10,0,0,0,-0.06, 0,1.10,0,0,-0.06, 0,0,1.10,0,-0.06, 0,0,0,1,0],
  )},

  // Ilford B&W
  { id: 'il1', label: 'HP5', previewColor: '#808080', defaultStrength: 1.0, matrix: buildFilter(
    [0.30,0.65,0.05,0,0.0, 0.30,0.65,0.05,0,0.0, 0.30,0.65,0.05,0,0.0, 0,0,0,1,0],
    [1.08,0,0,0,-0.02, 0,1.08,0,0,-0.02, 0,0,1.08,0,-0.02, 0,0,0,1,0],
  )},
  { id: 'il2', label: 'Delta', previewColor: '#606060', defaultStrength: 1.0, matrix: buildFilter(
    [0.35,0.60,0.05,0,0.0, 0.35,0.60,0.05,0,0.0, 0.35,0.60,0.05,0,0.0, 0,0,0,1,0],
    [1.22,0,0,0,-0.10, 0,1.22,0,0,-0.10, 0,0,1.22,0,-0.10, 0,0,0,1,0],
  )},

  // VHS / Retro
  { id: 'vr1', label: 'VHS', previewColor: '#8060A0', defaultStrength: 1.0, matrix: buildFilter(
    [1.10,0.06,0.08,0,0.04, 0.02,0.92,0.04,0,0.03, 0.06,-0.02,1.06,0,0.06, 0,0,0,1,0],
    [0.84,0,0,0,0.10, 0,0.84,0,0,0.10, 0,0,0.84,0,0.12, 0,0,0,1,0],
  )},
  { id: 'vr2', label: 'Retro', previewColor: '#B08050', defaultStrength: 1.0, matrix: buildFilter(
    [1.10,0.08,-0.02,0,0.06, 0.04,1.04,0.02,0,0.05, -0.04,0.02,0.78,0,0.08, 0,0,0,1,0],
    [0.88,0.04,0.02,0,0.08, 0.03,0.88,0.03,0,0.08, 0.02,0.04,0.88,0,0.10, 0,0,0,1,0],
  )},
  { id: 'vr3', label: '90s', previewColor: '#7B3880', defaultStrength: 1.0, matrix: buildFilter(
    [1.06,-0.02,0.08,0,0.02, -0.04,0.94,0.02,0,0.02, 0.06,-0.02,1.12,0,0.04, 0,0,0,1,0],
    [0.94,0.02,0.01,0,0.04, 0.01,0.94,0.02,0,0.04, 0.01,0.02,0.94,0,0.04, 0,0,0,1,0],
  )},

  // B&W
  { id: 'bw1', label: 'B&W', previewColor: '#909090', defaultStrength: 1.0, matrix: buildFilter(
    [0.2126,0.7152,0.0722,0,0.0, 0.2126,0.7152,0.0722,0,0.0, 0.2126,0.7152,0.0722,0,0.0, 0,0,0,1,0],
  )},
  { id: 'bw2', label: 'Noir', previewColor: '#404040', defaultStrength: 1.0, matrix: buildFilter(
    [0.35,0.75,0.08,0,0.0, 0.35,0.75,0.08,0,0.0, 0.35,0.75,0.08,0,0.0, 0,0,0,1,0],
    [1.22,0,0,0,-0.10, 0,1.22,0,0,-0.10, 0,0,1.22,0,-0.10, 0,0,0,1,0],
  )},
  { id: 'bw3', label: 'Silver', previewColor: '#B0B0B0', defaultStrength: 1.0, matrix: buildFilter(
    [0.24,0.64,0.08,0,0.0, 0.24,0.64,0.08,0,0.0, 0.24,0.64,0.08,0,0.0, 0,0,0,1,0],
    [0.82,0,0,0,0.12, 0,0.82,0,0,0.12, 0,0,0.82,0,0.12, 0,0,0,1,0],
  )},
  { id: 'bw4', label: 'Sepia', previewColor: '#8B7355', defaultStrength: 1.0, matrix: buildFilter(
    [0.39,0.69,0.09,0,0.0, 0.35,0.62,0.08,0,0.0, 0.27,0.48,0.06,0,0.0, 0,0,0,1,0],
  )},
  { id: 'bw5', label: 'Cyanotype', previewColor: '#4682B4', defaultStrength: 1.0, matrix: buildFilter(
    [0.18,0.52,0.06,0,0.0, 0.22,0.62,0.08,0,0.0, 0.30,0.72,0.14,0,0.02, 0,0,0,1,0],
  )},
];

// ── PRO FILTERS ──
const PRO = [
  // Cinematic
  { id: 'pro_cin1', label: 'Teal&Orange', previewColor: '#E87040', defaultStrength: 1.0, matrix: buildFilter(
    [1.20,0.04,-0.08,0,0.02, 0.0,0.94,-0.02,0,0.0, -0.06,-0.02,1.18,0,0.04, 0,0,0,1,0],
    [1.08,0,0,0,-0.04, 0,1.06,0,0,-0.03, 0,0,1.04,0,-0.02, 0,0,0,1,0],
  )},
  { id: 'pro_cin2', label: 'Blade', previewColor: '#50A0A0', defaultStrength: 1.0, matrix: buildFilter(
    [0.96,0.02,0.04,0,0.0, -0.02,1.04,0.06,0,0.0, 0.04,0.06,1.16,0,0.02, 0,0,0,1,0],
    [1.12,0,0,0,-0.06, 0,1.08,0,0,-0.04, 0,0,1.06,0,-0.02, 0,0,0,1,0],
  )},
  { id: 'pro_cin3', label: 'Matrix', previewColor: '#40A060', defaultStrength: 1.0, matrix: buildFilter(
    [0.86,0.04,-0.02,0,0.0, 0.02,1.12,0.02,0,0.02, -0.04,0.06,0.90,0,0.0, 0,0,0,1,0],
    [1.10,0,0,0,-0.06, 0,1.10,0,0,-0.04, 0,0,1.08,0,-0.04, 0,0,0,1,0],
  )},
  // Portrait
  { id: 'pro_pt1', label: 'Soft Glow', previewColor: '#F0C8A0', defaultStrength: 1.0, matrix: buildFilter(
    [1.08,0.04,-0.02,0,0.04, 0.02,1.06,0.0,0,0.03, -0.02,0.0,0.94,0,0.05, 0,0,0,1,0],
    [0.92,0,0,0,0.06, 0,0.92,0,0,0.06, 0,0,0.92,0,0.06, 0,0,0,1,0],
  )},
  { id: 'pro_pt2', label: 'Porcelain', previewColor: '#E8D0D0', defaultStrength: 1.0, matrix: buildFilter(
    [1.02,0.02,0.02,0,0.04, 0.01,1.02,0.02,0,0.04, 0.02,0.02,1.04,0,0.05, 0,0,0,1,0],
    [0.94,0.02,0.01,0,0.04, 0.01,0.94,0.02,0,0.04, 0.01,0.02,0.94,0,0.04, 0,0,0,1,0],
  )},
  // Food
  { id: 'pro_fd1', label: 'Warm Plate', previewColor: '#E8A050', defaultStrength: 1.0, matrix: buildFilter(
    [1.16,0.06,-0.04,0,0.02, 0.03,1.10,-0.01,0,0.01, -0.04,0.0,0.88,0,0.03, 0,0,0,1,0],
    [1.04,0,0,0,0.0, 0,1.04,0,0,0.0, 0,0,1.02,0,0.0, 0,0,0,1,0],
  )},
  { id: 'pro_fd2', label: 'Fresh', previewColor: '#80C060', defaultStrength: 1.0, matrix: buildFilter(
    [1.04,-0.02,0.0,0,0.02, -0.01,1.14,-0.02,0,0.01, 0.0,-0.02,1.06,0,0.02, 0,0,0,1,0],
    [1.06,0,0,0,-0.02, 0,1.06,0,0,-0.02, 0,0,1.06,0,-0.02, 0,0,0,1,0],
  )},
  // Travel
  { id: 'pro_tr1', label: 'Golden Hour', previewColor: '#E89030', defaultStrength: 1.0, matrix: buildFilter(
    [1.20,0.08,-0.06,0,0.04, 0.04,1.08,-0.02,0,0.02, -0.06,-0.02,0.84,0,0.04, 0,0,0,1,0],
    [0.96,0,0,0,0.03, 0,0.96,0,0,0.02, 0,0,0.94,0,0.02, 0,0,0,1,0],
  )},
  { id: 'pro_tr2', label: 'Azure', previewColor: '#4090C0', defaultStrength: 1.0, matrix: buildFilter(
    [0.94,-0.02,0.02,0,0.0, -0.02,1.06,0.02,0,0.0, 0.02,0.02,1.20,0,0.02, 0,0,0,1,0],
    [1.06,0,0,0,-0.02, 0,1.06,0,0,-0.02, 0,0,1.06,0,-0.02, 0,0,0,1,0],
  )},
  // Moody
  { id: 'pro_md1', label: 'Shadows', previewColor: '#3A3A5A', defaultStrength: 1.0, matrix: buildFilter(
    [0.90,0.02,0.04,0,-0.02, 0.0,0.88,0.04,0,-0.02, 0.02,0.04,0.96,0,0.0, 0,0,0,1,0],
    [1.14,0,0,0,-0.08, 0,1.12,0,0,-0.08, 0,0,1.10,0,-0.06, 0,0,0,1,0],
  )},
  { id: 'pro_md2', label: 'Ember', previewColor: '#A04030', defaultStrength: 1.0, matrix: buildFilter(
    [1.10,0.06,-0.04,0,-0.02, 0.02,0.92,0.0,0,-0.02, -0.06,-0.02,0.82,0,0.0, 0,0,0,1,0],
    [1.16,0,0,0,-0.10, 0,1.14,0,0,-0.10, 0,0,1.12,0,-0.08, 0,0,0,1,0],
  )},
  { id: 'pro_md3', label: 'Mist', previewColor: '#7080A0', defaultStrength: 1.0, matrix: buildFilter(
    [0.92,0.04,0.04,0,0.06, 0.02,0.92,0.04,0,0.06, 0.02,0.04,0.96,0,0.08, 0,0,0,1,0],
    [0.86,0,0,0,0.08, 0,0.86,0,0,0.08, 0,0,0.86,0,0.10, 0,0,0,1,0],
  )},
  // Film Stocks
  { id: 'fs_portra400', label: 'Portra 400', previewColor: '#E8C8A0', defaultStrength: 1.0, matrix: buildFilter(
    [1.06,0.04,-0.02,0,0.03, 0.02,1.04,0.0,0,0.02, -0.03,0.0,0.92,0,0.04, 0,0,0,1,0],
    [0.94,0.02,0.01,0,0.05, 0.01,0.94,0.02,0,0.04, 0.01,0.02,0.94,0,0.05, 0,0,0,1,0],
  )},
  { id: 'fs_portra800', label: 'Portra 800', previewColor: '#D4A070', defaultStrength: 1.0, matrix: buildFilter(
    [1.12,0.06,-0.04,0,0.04, 0.03,1.06,0.0,0,0.03, -0.05,-0.01,0.88,0,0.06, 0,0,0,1,0],
    [0.92,0.02,0.01,0,0.06, 0.01,0.92,0.02,0,0.05, 0.01,0.02,0.92,0,0.06, 0,0,0,1,0],
  )},
  { id: 'fs_ektar', label: 'Ektar 100', previewColor: '#E06030', defaultStrength: 1.0, matrix: buildFilter(
    [1.22,-0.04,0.02,0,-0.01, -0.01,1.18,-0.02,0,-0.02, 0.02,-0.04,1.20,0,-0.03, 0,0,0,1,0],
    [1.08,0,0,0,-0.04, 0,1.08,0,0,-0.04, 0,0,1.08,0,-0.04, 0,0,0,1,0],
  )},
  { id: 'fs_cinestill', label: 'CineStill 800T', previewColor: '#4080A0', defaultStrength: 1.0, matrix: buildFilter(
    [0.92,0.02,0.06,0,0.02, -0.02,1.02,0.04,0,0.01, 0.04,0.04,1.14,0,0.04, 0,0,0,1,0],
    [1.06,0,0,0,-0.02, 0,1.04,0,0,-0.02, 0,0,1.02,0,0.0, 0,0,0,1,0],
  )},
  { id: 'fs_pro400h', label: 'Pro 400H', previewColor: '#A0C8C0', defaultStrength: 1.0, matrix: buildFilter(
    [1.02,0.02,0.02,0,0.03, 0.01,1.06,0.01,0,0.02, 0.02,0.01,1.04,0,0.04, 0,0,0,1,0],
    [0.96,0.01,0.01,0,0.03, 0.01,0.96,0.01,0,0.03, 0.01,0.01,0.96,0,0.04, 0,0,0,1,0],
  )},
  { id: 'fs_velvia', label: 'Velvia 50', previewColor: '#2080A0', defaultStrength: 1.0, matrix: buildFilter(
    [1.28,-0.06,0.02,0,-0.02, -0.02,1.24,-0.04,0,-0.02, 0.02,-0.06,1.30,0,-0.04, 0,0,0,1,0],
    [1.10,0,0,0,-0.06, 0,1.10,0,0,-0.06, 0,0,1.10,0,-0.06, 0,0,0,1,0],
  )},
  { id: 'fs_leica', label: 'Leica M', previewColor: '#7A7060', defaultStrength: 1.0, matrix: buildFilter(
    [1.08,0.02,-0.02,0,-0.01, 0.0,1.04,0.0,0,-0.01, -0.02,0.0,1.00,0,0.0, 0,0,0,1,0],
    [0.92,0.03,0.02,0,0.02, 0.02,0.92,0.02,0,0.02, 0.02,0.02,0.92,0,0.02, 0,0,0,1,0],
    [1.14,0,0,0,-0.08, 0,1.12,0,0,-0.06, 0,0,1.10,0,-0.05, 0,0,0,1,0],
  )},
  { id: 'fs_trix', label: 'Tri-X 400', previewColor: '#505050', defaultStrength: 1.0, matrix: buildFilter(
    [0.33,0.62,0.05,0,0.0, 0.33,0.62,0.05,0,0.0, 0.33,0.62,0.05,0,0.0, 0,0,0,1,0],
    [1.18,0,0,0,-0.08, 0,1.18,0,0,-0.08, 0,0,1.18,0,-0.08, 0,0,0,1,0],
  )},

  // FX
  { id: 'pro_fx1', label: 'Flair', previewColor: '#F0A858', defaultStrength: 1.0, matrix: buildFilter(
    [1.18,0.06,-0.04,0,0.06, 0.04,1.10,-0.02,0,0.04, -0.08,-0.02,0.86,0,0.02, 0,0,0,1,0],
    [1.04,0.02,0.0,0,0.05, 0.02,1.02,0.0,0,0.03, 0.0,0.0,0.96,0,0.0, 0,0,0,1,0],
  )},
  { id: 'pro_fx2', label: 'Film Burn', previewColor: '#D84020', defaultStrength: 1.0, matrix: buildFilter(
    [1.32,0.10,-0.08,0,0.08, 0.02,0.98,-0.06,0,0.02, -0.12,-0.06,0.78,0,-0.02, 0,0,0,1,0],
    [0.92,0,0,0,0.10, 0,0.90,0,0,0.04, 0,0,0.88,0,0.02, 0,0,0,1,0],
    [1.08,0,0,0,-0.02, 0,1.06,0,0,-0.02, 0,0,1.04,0,-0.02, 0,0,0,1,0],
  )},
  { id: 'pro_fx3', label: 'Glare', previewColor: '#F8F0D0', defaultStrength: 1.0, matrix: buildFilter(
    [0.94,0.06,0.04,0,0.08, 0.04,0.94,0.04,0,0.07, 0.04,0.04,0.92,0,0.05, 0,0,0,1,0],
    [1.10,0.02,0.02,0,0.04, 0.02,1.08,0.02,0,0.04, 0.02,0.02,1.06,0,0.03, 0,0,0,1,0],
    [0.94,0.03,0.03,0,0.02, 0.03,0.94,0.03,0,0.02, 0.03,0.03,0.94,0,0.02, 0,0,0,1,0],
  )},
];

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, 'filters-free.json'), JSON.stringify(FREE, null, 2));
fs.writeFileSync(path.join(assetsDir, 'filters-pro.json'),  JSON.stringify(PRO,  null, 2));

console.log(`✓ filters-free.json — ${FREE.length} filters`);
console.log(`✓ filters-pro.json  — ${PRO.length} filters`);
