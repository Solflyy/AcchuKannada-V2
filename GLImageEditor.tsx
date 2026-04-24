/**
 * GLImageEditor — GPU-accelerated image editing using expo-gl + standard GLSL
 * Replaces broken SkSL pipeline with universally compatible OpenGL ES 2.0 shaders.
 *
 * Supports all 13 adjustments at the GPU level:
 *   brightness, contrast, highlights, shadows, saturation, vibrance,
 *   temp, tint, fade, dehaze, clarity, sharpness, grain
 * Plus filter preset color matrices.
 */

import React, { useRef, useEffect, useCallback, useState, useImperativeHandle } from 'react';
import { View, Image, Platform, PixelRatio } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import * as FileSystem from 'expo-file-system';

// ── Types ──
export interface GLEditorUniforms {
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  vibrance: number;
  temp: number;
  tint: number;
  fade: number;
  dehaze: number;
  clarity: number;
  sharpness: number;
  grain: number;
  grainSize: number;
  grainRoughness: number;
  grainColor: number;
  filterStrength: number;
  filterMatrix: number[] | null; // 20-element color matrix or null
  // HSL per-channel: 8 channels × 3 values (hue shift, sat shift, lum shift)
  hslRed: [number, number, number];
  hslOrange: [number, number, number];
  hslYellow: [number, number, number];
  hslGreen: [number, number, number];
  hslAqua: [number, number, number];
  hslBlue: [number, number, number];
  hslPurple: [number, number, number];
  hslMagenta: [number, number, number];
  // RGB Tone Curves: 17-point LUT per channel (shadows→highlights)
  curveR: number[];
  curveG: number[];
  curveB: number[];
  curveMaster: number[];
}

interface GLImageEditorProps {
  src: string;
  width: number;
  height: number;
  uniforms: GLEditorUniforms;
  transparent?: boolean;  // render with alpha — for overlays like subject cutout
  onReady?: () => void;
  onError?: () => void;
}

export interface GLImageEditorHandle {
  capture: (options?: { format?: 'png' | 'jpg'; quality?: number }) => Promise<string | null>;
}

// ── Vertex shader (full-screen quad) ──
const VERT_SRC = `
attribute vec2 aPosition;
varying vec2 vTexCoord;
void main() {
  vTexCoord = (aPosition + 1.0) * 0.5;
  // Flip Y for correct orientation
  vTexCoord.y = 1.0 - vTexCoord.y;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// ── Fragment shader — all adjustments + HSL + curves + advanced grain ──
const FRAG_SRC = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform vec2 uResolution;

// Adjustment uniforms
uniform float uBrightness;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uSaturation;
uniform float uVibrance;
uniform float uTemp;
uniform float uTint;
uniform float uFade;
uniform float uDehaze;
uniform float uClarity;
uniform float uSharpness;
uniform float uGrain;
uniform float uGrainSize;
uniform float uGrainRoughness;
uniform float uGrainColor;

// Filter color matrix (as 4 rows + offset)
uniform float uFilterStrength;
uniform vec4 uFR;  // row 0
uniform vec4 uFG;  // row 1
uniform vec4 uFB;  // row 2
uniform vec4 uFA;  // row 3
uniform vec4 uFOff; // offsets

// HSL per-channel: 8 channels × hue/sat/lum shifts (packed as vec3)
uniform vec3 uHslRed;
uniform vec3 uHslOrange;
uniform vec3 uHslYellow;
uniform vec3 uHslGreen;
uniform vec3 uHslAqua;
uniform vec3 uHslBlue;
uniform vec3 uHslPurple;
uniform vec3 uHslMagenta;

// RGB Tone Curves: 17 control points per channel (uniform arrays)
uniform float uCurveR[17];
uniform float uCurveG[17];
uniform float uCurveB[17];
uniform float uCurveMaster[17];
uniform float uCurvesActive; // 1.0 if curves are non-identity

// Pseudo-random hash for grain (high-quality, no visible patterns)
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(443.8975, 397.2973, 491.1871));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}

// Second independent hash for color grain channels
float hash2(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

// Third hash for blue channel color grain
float hash3(vec2 p) {
  p = fract(p * vec2(173.97, 651.23));
  p += dot(p, p.yx + 47.63);
  return fract(p.x * p.y);
}

// Box-Muller transform: convert uniform random [0,1] to Gaussian distribution
// Produces film-like grain distribution (most grains are subtle, few are bright/dark)
float gaussianNoise(vec2 uv) {
  float u1 = max(1.0e-6, hash(uv));
  float u2 = hash(uv + vec2(1.71, 3.29));
  return sqrt(-2.0 * log(u1)) * cos(6.28318530718 * u2);
}

// Smooth value noise with bicubic-like interpolation (no grid artifacts)
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Quintic Hermite interpolation (C2 continuous — no grid lines)
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i + vec2(0.0, 0.0));
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Multi-octave fractal noise for roughness control
float fbmNoise(vec2 p, float octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= octaves) break;
    // Blend in partial octave at the boundary
    float w = clamp(octaves - float(i), 0.0, 1.0);
    value += amplitude * w * (valueNoise(p * frequency) * 2.0 - 1.0);
    frequency *= 2.17;
    amplitude *= 0.48;
    p += vec2(5.3, 1.7); // domain shift to reduce pattern correlation
  }
  return value;
}

// RGB ↔ HSL conversion
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hue2rgb(p, q, hsl.x + 1.0/3.0),
    hue2rgb(p, q, hsl.x),
    hue2rgb(p, q, hsl.x - 1.0/3.0)
  );
}

// Sample a 17-point curve LUT via linear interpolation
float sampleCurve(float x, float curve[17]) {
  float t = clamp(x, 0.0, 1.0) * 16.0;
  int i = int(floor(t));
  if (i >= 16) return curve[16];
  float frac = t - float(i);
  // Manual index selection (GLSL ES 2.0 doesn't support dynamic array indexing well)
  float v0, v1;
  if (i == 0) { v0 = curve[0]; v1 = curve[1]; }
  else if (i == 1) { v0 = curve[1]; v1 = curve[2]; }
  else if (i == 2) { v0 = curve[2]; v1 = curve[3]; }
  else if (i == 3) { v0 = curve[3]; v1 = curve[4]; }
  else if (i == 4) { v0 = curve[4]; v1 = curve[5]; }
  else if (i == 5) { v0 = curve[5]; v1 = curve[6]; }
  else if (i == 6) { v0 = curve[6]; v1 = curve[7]; }
  else if (i == 7) { v0 = curve[7]; v1 = curve[8]; }
  else if (i == 8) { v0 = curve[8]; v1 = curve[9]; }
  else if (i == 9) { v0 = curve[9]; v1 = curve[10]; }
  else if (i == 10) { v0 = curve[10]; v1 = curve[11]; }
  else if (i == 11) { v0 = curve[11]; v1 = curve[12]; }
  else if (i == 12) { v0 = curve[12]; v1 = curve[13]; }
  else if (i == 13) { v0 = curve[13]; v1 = curve[14]; }
  else if (i == 14) { v0 = curve[14]; v1 = curve[15]; }
  else { v0 = curve[15]; v1 = curve[16]; }
  return mix(v0, v1, frac);
}

void main() {
  vec4 pixel = texture2D(uTexture, vTexCoord);
  float r = pixel.r;
  float g = pixel.g;
  float b = pixel.b;
  float a = pixel.a;

  // ── Filter preset (color matrix) ──
  if (uFilterStrength > 0.0) {
    vec4 orig = vec4(r, g, b, a);
    float fr = dot(orig, uFR) + uFOff.x;
    float fg = dot(orig, uFG) + uFOff.y;
    float fb = dot(orig, uFB) + uFOff.z;
    float fa = dot(orig, uFA) + uFOff.w;
    r = mix(r, clamp(fr, 0.0, 1.0), uFilterStrength);
    g = mix(g, clamp(fg, 0.0, 1.0), uFilterStrength);
    b = mix(b, clamp(fb, 0.0, 1.0), uFilterStrength);
    a = mix(a, clamp(fa, 0.0, 1.0), uFilterStrength);
  }

  // ── Brightness (Snapseed-style: additive with highlight/shadow protection) ──
  // Snapseed brightness doesn't blow out highlights — it compresses toward 1.0
  if (uBrightness != 0.0) {
    float br = uBrightness * 0.25; // max ±0.25 offset
    if (br > 0.0) {
      // Positive: add brightness but protect highlights (less effect on bright pixels)
      r += br * (1.0 - r * 0.7);
      g += br * (1.0 - g * 0.7);
      b += br * (1.0 - b * 0.7);
    } else {
      // Negative: darken but protect shadows (less effect on dark pixels)
      r += br * (0.3 + r * 0.7);
      g += br * (0.3 + g * 0.7);
      b += br * (0.3 + b * 0.7);
    }
  }

  // ── Contrast (Snapseed-style: scale around midpoint, ~+20 feel at max) ──
  if (uContrast != 0.0) {
    float c = 1.0 + uContrast * 0.35;
    float t = 0.5 * (1.0 - c);
    r = r * c + t;
    g = g * c + t;
    b = b * c + t;
  }

  // ── Luminance for tonal targeting ──
  float luma = r * 0.2126 + g * 0.7152 + b * 0.0722;

  // ── Highlights (Snapseed-style: recover/boost bright areas, ~-40 at max) ──
  if (uHighlights != 0.0) {
    float mask = smoothstep(0.5, 1.0, luma);
    // Negative = recover (compress highlights), Positive = boost
    float adj = uHighlights * 0.25 * mask;
    r += adj; g += adj; b += adj;
  }

  // ── Shadows (Snapseed-style: lift/crush dark areas, ~+25 at max) ──
  if (uShadows != 0.0) {
    float mask = 1.0 - smoothstep(0.0, 0.5, luma);
    float adj = uShadows * 0.25 * mask;
    r += adj; g += adj; b += adj;
  }

  // ── Fade (subtle black lift — film look) ──
  if (uFade > 0.0) {
    float fl = uFade * 0.15;
    r = max(r, fl); g = max(g, fl); b = max(b, fl);
    float fm = uFade * 0.06;
    r = mix(r, 0.5, fm); g = mix(g, 0.5, fm); b = mix(b, 0.5, fm);
  }

  // ── Dehaze (Snapseed-style: moderate contrast + clarity + sat) ──
  if (uDehaze != 0.0) {
    float dc = 1.0 + uDehaze * 0.3;
    r = (r - 0.5) * dc + 0.5;
    g = (g - 0.5) * dc + 0.5;
    b = (b - 0.5) * dc + 0.5;
    float dl = r * 0.2126 + g * 0.7152 + b * 0.0722;
    float ds = 1.0 + uDehaze * 0.15;
    r = mix(dl, r, ds); g = mix(dl, g, ds); b = mix(dl, b, ds);
    if (uDehaze > 0.0) {
      float sm = 1.0 - smoothstep(0.0, 0.5, luma);
      float dd = uDehaze * 0.05 * sm;
      r -= dd; g -= dd; b -= dd;
    }
  }

  // ── Saturation (Snapseed-style: ~+15 feel at max, Rec.709) ──
  if (uSaturation != 0.0) {
    float sl = r * 0.2126 + g * 0.7152 + b * 0.0722;
    float sf = 1.0 + uSaturation * 0.5;
    r = mix(sl, r, sf); g = mix(sl, g, sf); b = mix(sl, b, sf);
  }

  // ── Vibrance / Ambiance (Snapseed-style: selective, ~+30 at max) ──
  if (uVibrance != 0.0) {
    float mx = max(r, max(g, b));
    float mn = min(r, min(g, b));
    float ps = (mx - mn) / (mx + 0.001);
    float boost = uVibrance * (1.0 - ps) * 0.35;
    float vl = r * 0.2126 + g * 0.7152 + b * 0.0722;
    float vf = 1.0 + boost;
    r = mix(vl, r, vf); g = mix(vl, g, vf); b = mix(vl, b, vf);
  }

  // ── Temperature (Snapseed-style: subtle warm/cool white balance) ──
  if (uTemp != 0.0) {
    float tw = uTemp * 0.08;
    r += tw;
    g += tw * 0.02;
    b -= tw;
  }

  // ── Tint (Snapseed-style: subtle green/magenta) ──
  if (uTint != 0.0) {
    float ti = uTint * 0.06;
    r += ti;
    g -= abs(ti) * 0.8;
    b += ti;
  }

  // ── Clarity / Structure (Snapseed-style: ~+15 at max, midtone only) ──
  if (uClarity != 0.0) {
    float mm = 4.0 * luma * (1.0 - luma);
    float cf = 1.0 + uClarity * 0.2 * mm;
    r = (r - 0.5) * cf + 0.5;
    g = (g - 0.5) * cf + 0.5;
    b = (b - 0.5) * cf + 0.5;
    float cl2 = r * 0.2126 + g * 0.7152 + b * 0.0722;
    float cs = 1.0 + uClarity * 0.08 * mm;
    r = mix(cl2, r, cs); g = mix(cl2, g, cs); b = mix(cl2, b, cs);
  }

  // ── Sharpness (Snapseed-style: ~+20 at max, subtle unsharp mask) ──
  if (uSharpness != 0.0) {
    vec2 texel = 1.0 / uResolution;
    vec3 left  = texture2D(uTexture, vTexCoord + vec2(-texel.x, 0.0)).rgb;
    vec3 right = texture2D(uTexture, vTexCoord + vec2( texel.x, 0.0)).rgb;
    vec3 up    = texture2D(uTexture, vTexCoord + vec2(0.0, -texel.y)).rgb;
    vec3 down  = texture2D(uTexture, vTexCoord + vec2(0.0,  texel.y)).rgb;
    vec3 center = vec3(r, g, b);
    vec3 detail = 4.0 * center - left - right - up - down;
    float sh = uSharpness * 0.25;
    r += detail.r * sh;
    g += detail.g * sh;
    b += detail.b * sh;
  }

  // ── Grain (Procedural Film Grain — Snapseed/Lightroom quality) ──
  // Amount: intensity of grain overlay
  // Size: grain particle size (simulates ISO — larger = higher ISO like 3200)
  // Roughness: sharp fine grain (low) vs coarse fractal grain (high)
  // Color: per-channel color variation (chromatic grain)
  if (uGrain > 0.0) {
    // Base coordinate at native pixel resolution (no floor/quantization = no grid)
    vec2 pixelCoord = gl_FragCoord.xy;

    // Size controls the noise frequency — lower frequency = larger grain particles
    // Range: 1.0 (fine, ISO 100) → 0.1 (coarse, ISO 3200)
    float noiseFreq = mix(1.0, 0.12, uGrainSize);
    vec2 noiseUV = pixelCoord * noiseFreq;

    // Generate grain based on roughness:
    // Low roughness = pure Gaussian (smooth, analog film look)
    // High roughness = multi-octave fractal noise (harsh, gritty, digital-camera-at-high-ISO look)
    float octaves = 1.0 + uGrainRoughness * 3.0; // 1 to 4 octaves
    float grainFine = gaussianNoise(pixelCoord + vec2(0.137, 0.249));
    float grainRough = fbmNoise(noiseUV, octaves);

    // Blend between Gaussian (smooth film) and fractal (rough/gritty)
    float noise = mix(grainFine * 0.4, grainRough, uGrainRoughness);

    // Luminance-adaptive grain: more visible in shadows/midtones, less in highlights
    // Mimics real film where grain is embedded in the emulsion density
    float lumaMask = 1.0 - smoothstep(0.35, 0.95, luma) * 0.6;

    // Apply monochromatic grain
    float grainAmount = noise * uGrain * 0.18 * lumaMask;

    // Color grain variation (chromatic noise — different per R/G/B channel)
    if (uGrainColor > 0.01) {
      float noiseR = mix(
        gaussianNoise(pixelCoord + vec2(13.7, 29.3)) * 0.4,
        fbmNoise(noiseUV + vec2(13.7, 29.3), octaves),
        uGrainRoughness
      );
      float noiseB = mix(
        gaussianNoise(pixelCoord + vec2(47.1, 7.9)) * 0.4,
        fbmNoise(noiseUV + vec2(47.1, 7.9), octaves),
        uGrainRoughness
      );
      float colorAmt = uGrainColor * uGrain * 0.10 * lumaMask;
      r += grainAmount + noiseR * colorAmt;
      g += grainAmount;
      b += grainAmount + noiseB * colorAmt;
    } else {
      r += grainAmount;
      g += grainAmount;
      b += grainAmount;
    }

    // Subtle desaturation from grain (film grain reduces color purity slightly)
    float gLum = r * 0.2126 + g * 0.7152 + b * 0.0722;
    float desatAmt = uGrain * 0.04;
    r = mix(r, gLum, desatAmt);
    g = mix(g, gLum, desatAmt);
    b = mix(b, gLum, desatAmt);
  }

  // ── HSL Per-Channel Adjustments ──
  {
    vec3 hsl = rgb2hsl(clamp(vec3(r, g, b), 0.0, 1.0));
    float h360 = hsl.x * 360.0;
    // Determine channel weights (smooth transitions between ranges)
    // Red: 330-30, Orange: 15-45, Yellow: 35-70, Green: 70-170, Aqua: 170-210, Blue: 210-270, Purple: 270-310, Magenta: 310-345
    float wRed = smoothstep(330.0, 345.0, h360) + (1.0 - smoothstep(0.0, 30.0, h360));
    float wOrange = smoothstep(10.0, 25.0, h360) * (1.0 - smoothstep(40.0, 55.0, h360));
    float wYellow = smoothstep(35.0, 50.0, h360) * (1.0 - smoothstep(65.0, 80.0, h360));
    float wGreen = smoothstep(65.0, 90.0, h360) * (1.0 - smoothstep(155.0, 175.0, h360));
    float wAqua = smoothstep(160.0, 180.0, h360) * (1.0 - smoothstep(200.0, 220.0, h360));
    float wBlue = smoothstep(195.0, 220.0, h360) * (1.0 - smoothstep(265.0, 285.0, h360));
    float wPurple = smoothstep(260.0, 280.0, h360) * (1.0 - smoothstep(305.0, 325.0, h360));
    float wMagenta = smoothstep(300.0, 320.0, h360) * (1.0 - smoothstep(340.0, 355.0, h360));
    
    float hShift = wRed * uHslRed.x + wOrange * uHslOrange.x + wYellow * uHslYellow.x +
                   wGreen * uHslGreen.x + wAqua * uHslAqua.x + wBlue * uHslBlue.x +
                   wPurple * uHslPurple.x + wMagenta * uHslMagenta.x;
    float sShift = wRed * uHslRed.y + wOrange * uHslOrange.y + wYellow * uHslYellow.y +
                   wGreen * uHslGreen.y + wAqua * uHslAqua.y + wBlue * uHslBlue.y +
                   wPurple * uHslPurple.y + wMagenta * uHslMagenta.y;
    float lShift = wRed * uHslRed.z + wOrange * uHslOrange.z + wYellow * uHslYellow.z +
                   wGreen * uHslGreen.z + wAqua * uHslAqua.z + wBlue * uHslBlue.z +
                   wPurple * uHslPurple.z + wMagenta * uHslMagenta.z;
    
    if (abs(hShift) + abs(sShift) + abs(lShift) > 0.001) {
      hsl.x = fract(hsl.x + hShift / 360.0);
      hsl.y = clamp(hsl.y + sShift, 0.0, 1.0);
      hsl.z = clamp(hsl.z + lShift, 0.0, 1.0);
      vec3 rgb = hsl2rgb(hsl);
      r = rgb.r; g = rgb.g; b = rgb.b;
    }
  }

  // ── RGB Tone Curves ──
  if (uCurvesActive > 0.5) {
    r = sampleCurve(clamp(r, 0.0, 1.0), uCurveMaster);
    g = sampleCurve(clamp(g, 0.0, 1.0), uCurveMaster);
    b = sampleCurve(clamp(b, 0.0, 1.0), uCurveMaster);
    r = sampleCurve(clamp(r, 0.0, 1.0), uCurveR);
    g = sampleCurve(clamp(g, 0.0, 1.0), uCurveG);
    b = sampleCurve(clamp(b, 0.0, 1.0), uCurveB);
  }

  gl_FragColor = vec4(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), a);
}
`;

// ── GL state management ──
interface GLState {
  gl: ExpoWebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  locs: Record<string, WebGLUniformLocation | null>;
  texW: number;
  texH: number;
  transparent?: boolean;
}

function compileShader(gl: ExpoWebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('GL shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: ExpoWebGLRenderingContext): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('GL program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function getUniformLocations(gl: ExpoWebGLRenderingContext, program: WebGLProgram): Record<string, WebGLUniformLocation | null> {
  const names = [
    'uTexture', 'uResolution',
    'uBrightness', 'uContrast', 'uHighlights', 'uShadows',
    'uSaturation', 'uVibrance', 'uTemp', 'uTint',
    'uFade', 'uDehaze', 'uClarity', 'uSharpness', 'uGrain',
    'uGrainSize', 'uGrainRoughness', 'uGrainColor',
    'uFilterStrength', 'uFR', 'uFG', 'uFB', 'uFA', 'uFOff',
    'uHslRed', 'uHslOrange', 'uHslYellow', 'uHslGreen',
    'uHslAqua', 'uHslBlue', 'uHslPurple', 'uHslMagenta',
    'uCurvesActive',
  ];
  const locs: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) {
    locs[name] = gl.getUniformLocation(program, name);
  }
  // Array uniforms for curves
  for (let i = 0; i < 17; i++) {
    locs[`uCurveR_${i}`] = gl.getUniformLocation(program, `uCurveR[${i}]`);
    locs[`uCurveG_${i}`] = gl.getUniformLocation(program, `uCurveG[${i}]`);
    locs[`uCurveB_${i}`] = gl.getUniformLocation(program, `uCurveB[${i}]`);
    locs[`uCurveMaster_${i}`] = gl.getUniformLocation(program, `uCurveMaster[${i}]`);
  }
  return locs;
}

function setupQuad(gl: ExpoWebGLRenderingContext, program: WebGLProgram) {
  const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
}

async function loadTexture(gl: ExpoWebGLRenderingContext, src: string): Promise<{ texture: WebGLTexture; w: number; h: number } | null> {
  const texture = gl.createTexture();
  if (!texture) return null;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Set parameters for non-power-of-2 textures
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Load image data via expo-asset approach
  try {
    // For expo-gl, we use texImage2D with an asset object
    const asset = { localUri: src };
    // @ts-ignore — expo-gl extends texImage2D to accept asset objects
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, asset as any);

    // Get actual texture dimensions from image
    // We'll use the dimensions passed from the parent component
    return { texture, w: 0, h: 0 };
  } catch (e) {
    console.warn('GL texture load failed:', e);
    gl.deleteTexture(texture);
    return null;
  }
}

function renderFrame(state: GLState, uniforms: GLEditorUniforms, skipPresent = false) {
  const { gl, program, texture, locs, texW, texH, transparent } = state;

  if (transparent) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(locs.uTexture, 0);

  // Resolution for sharpness neighbor sampling
  gl.uniform2f(locs.uResolution, texW, texH);

  // Set all adjustment uniforms
  gl.uniform1f(locs.uBrightness, uniforms.brightness);
  gl.uniform1f(locs.uContrast, uniforms.contrast);
  gl.uniform1f(locs.uHighlights, uniforms.highlights);
  gl.uniform1f(locs.uShadows, uniforms.shadows);
  gl.uniform1f(locs.uSaturation, uniforms.saturation);
  gl.uniform1f(locs.uVibrance, uniforms.vibrance);
  gl.uniform1f(locs.uTemp, uniforms.temp);
  gl.uniform1f(locs.uTint, uniforms.tint);
  gl.uniform1f(locs.uFade, uniforms.fade);
  gl.uniform1f(locs.uDehaze, uniforms.dehaze);
  gl.uniform1f(locs.uClarity, uniforms.clarity);
  gl.uniform1f(locs.uSharpness, uniforms.sharpness);
  gl.uniform1f(locs.uGrain, uniforms.grain);
  gl.uniform1f(locs.uGrainSize, uniforms.grainSize || 0);
  gl.uniform1f(locs.uGrainRoughness, uniforms.grainRoughness || 0.5);
  gl.uniform1f(locs.uGrainColor, uniforms.grainColor || 0);

  // HSL per-channel — hue stored as degrees (-180..180), sat/lum stored as -100..100
  // Shader expects: hue in degrees (divided by 360 internally), sat/lum as -1..1 fraction
  const toHslUniform = (h: number, s: number, l: number): [number, number, number] => [h, s / 100, l / 100];
  gl.uniform3f(locs.uHslRed, ...toHslUniform(...uniforms.hslRed));
  gl.uniform3f(locs.uHslOrange, ...toHslUniform(...uniforms.hslOrange));
  gl.uniform3f(locs.uHslYellow, ...toHslUniform(...uniforms.hslYellow));
  gl.uniform3f(locs.uHslGreen, ...toHslUniform(...uniforms.hslGreen));
  gl.uniform3f(locs.uHslAqua, ...toHslUniform(...uniforms.hslAqua));
  gl.uniform3f(locs.uHslBlue, ...toHslUniform(...uniforms.hslBlue));
  gl.uniform3f(locs.uHslPurple, ...toHslUniform(...uniforms.hslPurple));
  gl.uniform3f(locs.uHslMagenta, ...toHslUniform(...uniforms.hslMagenta));

  // Tone Curves
  const IDENTITY_CURVE = [0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5, 0.5625, 0.625, 0.6875, 0.75, 0.8125, 0.875, 0.9375, 1.0];
  const isIdentity = (c: number[]) => c.length === 17 && c.every((v, i) => Math.abs(v - IDENTITY_CURVE[i]) < 0.001);
  const curvesActive = !(isIdentity(uniforms.curveR) && isIdentity(uniforms.curveG) && isIdentity(uniforms.curveB) && isIdentity(uniforms.curveMaster));
  gl.uniform1f(locs.uCurvesActive, curvesActive ? 1.0 : 0.0);
  for (let i = 0; i < 17; i++) {
    gl.uniform1f(locs[`uCurveR_${i}`], uniforms.curveR[i] ?? IDENTITY_CURVE[i]);
    gl.uniform1f(locs[`uCurveG_${i}`], uniforms.curveG[i] ?? IDENTITY_CURVE[i]);
    gl.uniform1f(locs[`uCurveB_${i}`], uniforms.curveB[i] ?? IDENTITY_CURVE[i]);
    gl.uniform1f(locs[`uCurveMaster_${i}`], uniforms.curveMaster[i] ?? IDENTITY_CURVE[i]);
  }

  // Filter matrix
  const m = uniforms.filterMatrix;
  gl.uniform1f(locs.uFilterStrength, m ? uniforms.filterStrength : 0);
  if (m && uniforms.filterStrength > 0) {
    gl.uniform4f(locs.uFR, m[0], m[1], m[2], m[3]);
    gl.uniform4f(locs.uFG, m[5], m[6], m[7], m[8]);
    gl.uniform4f(locs.uFB, m[10], m[11], m[12], m[13]);
    gl.uniform4f(locs.uFA, m[15], m[16], m[17], m[18]);
    gl.uniform4f(locs.uFOff, m[4], m[9], m[14], m[19]);
  } else {
    gl.uniform4f(locs.uFR, 1, 0, 0, 0);
    gl.uniform4f(locs.uFG, 0, 1, 0, 0);
    gl.uniform4f(locs.uFB, 0, 0, 1, 0);
    gl.uniform4f(locs.uFA, 0, 0, 0, 1);
    gl.uniform4f(locs.uFOff, 0, 0, 0, 0);
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  if (!skipPresent) gl.endFrameEXP();
}

// ── React Component ──
export const GLImageEditor = React.memo(React.forwardRef<GLImageEditorHandle, GLImageEditorProps>(
  ({ src, width, height, uniforms, transparent, onReady, onError }, ref) => {
  const glStateRef = useRef<GLState | null>(null);
  const uniformsRef = useRef(uniforms);
  uniformsRef.current = uniforms;
  const srcRef = useRef(src);
  const [glReady, setGlReady] = useState(false);
  const [glFailed, setGlFailed] = useState(false);
  const [textureReady, setTextureReady] = useState(true);
  const rafRef = useRef<number | null>(null);
  const needsRenderRef = useRef(true);

  // Expose capture method for export (reads GL framebuffer with all effects including grain)
  useImperativeHandle(ref, () => ({
    capture: async (options) => {
      const state = glStateRef.current;
      if (!state?.gl) return null;
      if (glFailed) return null;
      // Require a live texture and at least one successful render before snapshotting —
      // calling takeSnapshotAsync before a valid frame is on the FBO can crash natively.
      if (!state.texture) return null;
      try {
        // Render fresh with present=true so FBO has a valid frame.
        renderFrame(state, uniformsRef.current);
        // Give the GPU a frame to finish drawing before reading pixels.
        await new Promise(resolve => setTimeout(resolve, 60));
        const snapshot = await GLView.takeSnapshotAsync(state.gl, {
          format: options?.format || 'jpeg',
          compress: options?.quality ?? 0.95,
          flip: false,
        });
        if (!snapshot || !snapshot.uri) return null;
        const uri = typeof snapshot.uri === 'string' ? snapshot.uri : String(snapshot.uri);
        return uri.startsWith('file://') || uri.startsWith('http') ? uri : `file://${uri}`;
      } catch (e) {
        console.warn('GL capture failed:', e);
        return null;
      }
    }
  }));

  // Re-render when uniforms change
  useEffect(() => {
    needsRenderRef.current = true;
    if (glStateRef.current) {
      renderFrame(glStateRef.current, uniforms);
    }
  }, [uniforms]);

  // Reload texture when src changes. Hide GL overlay until new texture is ready
  // so the fallback <Image> layer shows the new image cleanly (prevents the brief
  // "zoom/stretch flash" of the old framebuffer being scaled to new view size).
  useEffect(() => {
    if (!glStateRef.current || src === srcRef.current) return;
    srcRef.current = src;
    const state = glStateRef.current;
    const gl = state.gl;
    setTextureReady(false);

    (async () => {
      try {
        if (state.texture) gl.deleteTexture(state.texture);
        const result = await loadTexture(gl, src);
        if (result) {
          state.texture = result.texture;
          state.texW = width;
          state.texH = height;
          renderFrame(state, uniformsRef.current);
          setTextureReady(true);
        }
      } catch (e) {
        console.warn('GL texture reload failed:', e);
        setTextureReady(true); // avoid permanently hidden GL
      }
    })();
  }, [src]);

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    try {
      const program = createProgram(gl);
      if (!program) {
        setGlFailed(true);
        onError?.();
        return;
      }

      gl.useProgram(program);
      setupQuad(gl, program);
      const locs = getUniformLocations(gl, program);

      // Load initial texture
      const result = await loadTexture(gl, src);
      if (!result) {
        setGlFailed(true);
        onError?.();
        return;
      }

      const state: GLState = {
        gl,
        program,
        texture: result.texture,
        locs,
        texW: width,
        texH: height,
      };

      glStateRef.current = state;

      // Set viewport
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      // Transparency support: enable alpha blending so cutout PNG transparent areas show through
      if (transparent) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        state.transparent = true;
      }

      // Initial render
      renderFrame(state, uniformsRef.current);

      setGlReady(true);
      onReady?.();
    } catch (e) {
      console.warn('GL context creation failed:', e);
      setGlFailed(true);
      onError?.();
    }
  }, [src, width, height]);

  if (glFailed) return null; // Caller should fall back to ColorMatrix

  return (
    <GLView
      style={[{ width, height }, transparent ? { backgroundColor: 'transparent' } : {}, !textureReady ? { opacity: 0 } : null]}
      onContextCreate={onContextCreate}
      msaaSamples={0}
    />
  );
}));

export default GLImageEditor;
