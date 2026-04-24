import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Constants from 'expo-constants';
import { StyleSheet, Text, View, Image, TouchableOpacity, Dimensions, PanResponder, SafeAreaView, StatusBar, TextInput, KeyboardAvoidingView, Platform, ScrollView, TouchableWithoutFeedback, TextStyle, ActivityIndicator, useWindowDimensions, Modal, Animated, Easing, PixelRatio, NativeModules, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import ViewShot from 'react-native-view-shot';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path, Line, Circle as SvgCircle, Rect as SvgRect } from 'react-native-svg';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorMatrix, concatColorMatrices } from 'react-native-color-matrix-image-filters';
import { LinearGradient } from 'expo-linear-gradient';
import { UIManager } from 'react-native';
import * as Print from 'expo-print';
import { File as ExpoFile } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { GLImageEditor, GLEditorUniforms, GLImageEditorHandle } from './GLImageEditor';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Accelerometer } from 'expo-sensors';
import MaskedView from '@react-native-masked-view/masked-view';
import * as DocumentPicker from 'expo-document-picker';
import { initBilling, buyPlan, restorePurchases, PRO_STORAGE_KEY, type PlanId } from './billing';
import { BannerAd, BannerAdSize, TestIds, MobileAds } from 'react-native-google-mobile-ads';

// AdMob Ad Unit IDs – replace TEST IDs with real ones from admob.google.com before release
const ADMOB_BANNER_ID = __DEV__ ? TestIds.BANNER : 'ca-app-pub-3940256099942544/6300978111'; // TODO: replace with your real banner ad unit ID

const HAS_COLOR_MATRIX = UIManager.getViewManagerConfig?.('CMIFColorMatrixImageFilter') != null;

// ── Skia GPU shader pipeline (optional — falls back gracefully in Expo Go) ──
let SkiaCanvas: any = null, SkiaFill: any = null, SkiaShader: any = null,
    SkiaImageShader: any = null, useSkiaImage: any = null, SkiaObj: any = null;
let HAS_SKIA_MODULE = false;
let _skiaModuleDebug = '';
try {
  const sk = require('@shopify/react-native-skia');
  _skiaModuleDebug += 'M';
  SkiaCanvas = sk.Canvas; SkiaFill = sk.Fill; SkiaShader = sk.Shader;
  SkiaImageShader = sk.ImageShader; useSkiaImage = sk.useImage; SkiaObj = sk.Skia;
  _skiaModuleDebug += SkiaObj ? 'S' : 's';
  if (SkiaObj) {
    _skiaModuleDebug += SkiaObj.RuntimeEffect ? 'R' : 'r';
    if (SkiaObj.RuntimeEffect) {
      _skiaModuleDebug += typeof SkiaObj.RuntimeEffect.Make === 'function' ? 'F' : 'f';
    }
  }
  HAS_SKIA_MODULE = true;
} catch (e: any) {
  _skiaModuleDebug += 'E:' + (e?.message || '?').substring(0, 20);
}

// ── SkSL shader source — ALL float types (no half/float mixing) ──
const ADJUST_SHADER_SRC = `
uniform shader image;
uniform float brightness;
uniform float contrast;
uniform float highlights;
uniform float shadows;
uniform float saturation;
uniform float vibrance;
uniform float temp;
uniform float tint;
uniform float fade;
uniform float dehaze;
uniform float clarity;
uniform float sharpness;
uniform float filterStrength;
uniform float4 fR;
uniform float4 fG;
uniform float4 fB;
uniform float4 fA;
uniform float4 fOff;

half4 main(float2 coord) {
    float4 p = float4(image.eval(coord));
    float r = p.r;
    float g = p.g;
    float b = p.b;
    float a = p.a;

    // ── Filter preset (color matrix) ──
    if (filterStrength > 0.0) {
        float4 orig = float4(r, g, b, a);
        float fr = dot(orig, fR) + fOff.x;
        float fg = dot(orig, fG) + fOff.y;
        float fb = dot(orig, fB) + fOff.z;
        float fa = dot(orig, fA) + fOff.w;
        r = mix(r, clamp(fr, 0.0, 1.0), filterStrength);
        g = mix(g, clamp(fg, 0.0, 1.0), filterStrength);
        b = mix(b, clamp(fb, 0.0, 1.0), filterStrength);
        a = mix(a, clamp(fa, 0.0, 1.0), filterStrength);
    }

    // ── Brightness (EV-style multiplicative) ──
    if (brightness != 0.0) {
        float bf = pow(2.0, brightness * 1.5);
        r *= bf; g *= bf; b *= bf;
    }

    // ── Contrast (S-curve hermite for positive, flatten for negative) ──
    if (contrast != 0.0) {
        if (contrast > 0.0) {
            float cr = clamp(r, 0.0, 1.0);
            float cg = clamp(g, 0.0, 1.0);
            float cb = clamp(b, 0.0, 1.0);
            cr = cr * cr * (3.0 - 2.0 * cr);
            cg = cg * cg * (3.0 - 2.0 * cg);
            cb = cb * cb * (3.0 - 2.0 * cb);
            r = mix(r, cr, contrast);
            g = mix(g, cg, contrast);
            b = mix(b, cb, contrast);
        } else {
            float amt = -contrast * 0.8;
            r = mix(r, 0.5, amt);
            g = mix(g, 0.5, amt);
            b = mix(b, 0.5, amt);
        }
    }

    // ── Luminance for tonal targeting ──
    float luma = r * 0.2126 + g * 0.7152 + b * 0.0722;

    // ── Highlights (bright pixels only via smoothstep mask) ──
    if (highlights != 0.0) {
        float mask = smoothstep(0.2, 0.9, luma);
        float adj = highlights * 0.7 * mask;
        r += adj; g += adj; b += adj;
    }

    // ── Shadows (dark pixels only via inverse smoothstep mask) ──
    if (shadows != 0.0) {
        float mask = 1.0 - smoothstep(0.1, 0.8, luma);
        float adj = shadows * 0.7 * mask;
        r += adj; g += adj; b += adj;
    }

    // ── Fade (lift blacks toward gray) ──
    if (fade > 0.0) {
        float fl = fade * 0.4;
        r = max(r, fl); g = max(g, fl); b = max(b, fl);
        float fm = fade * 0.15;
        r = mix(r, 0.5, fm); g = mix(g, 0.5, fm); b = mix(b, 0.5, fm);
    }

    // ── Dehaze (contrast + saturation + shadow darkening) ──
    if (dehaze != 0.0) {
        float dc = 1.0 + dehaze * 0.9;
        r = (r - 0.5) * dc + 0.5;
        g = (g - 0.5) * dc + 0.5;
        b = (b - 0.5) * dc + 0.5;
        float dl = r * 0.2126 + g * 0.7152 + b * 0.0722;
        float ds = 1.0 + dehaze * 0.4;
        r = mix(dl, r, ds); g = mix(dl, g, ds); b = mix(dl, b, ds);
        if (dehaze > 0.0) {
            float sm = 1.0 - smoothstep(0.0, 0.5, luma);
            float dd = dehaze * 0.15 * sm;
            r -= dd; g -= dd; b -= dd;
        }
    }

    // ── Saturation (Rec.709 luminance-preserving) ──
    if (saturation != 0.0) {
        float sl = r * 0.2126 + g * 0.7152 + b * 0.0722;
        float sf = 1.0 + saturation;
        r = mix(sl, r, sf); g = mix(sl, g, sf); b = mix(sl, b, sf);
    }

    // ── Vibrance (selective — low-saturation pixels boosted more) ──
    if (vibrance != 0.0) {
        float mx = max(r, max(g, b));
        float mn = min(r, min(g, b));
        float ps = (mx - mn) / (mx + 0.001);
        float boost = vibrance * (1.0 - ps) * 0.8;
        float vl = r * 0.2126 + g * 0.7152 + b * 0.0722;
        float vf = 1.0 + boost;
        r = mix(vl, r, vf); g = mix(vl, g, vf); b = mix(vl, b, vf);
    }

    // ── Temperature (warm/cool) ──
    if (temp != 0.0) {
        float tw = temp * 0.5;
        r += tw * 0.45; g += tw * 0.05; b -= tw * 0.45;
    }

    // ── Tint (green/magenta) ──
    if (tint != 0.0) {
        float ti = tint * 0.45;
        r += ti * 0.35; g -= abs(ti) * 0.35; b += ti * 0.35;
    }

    // ── Clarity (midtone contrast + saturation boost) ──
    if (clarity != 0.0) {
        float mm = 4.0 * luma * (1.0 - luma);
        float cf = 1.0 + clarity * 0.6 * mm;
        r = (r - 0.5) * cf + 0.5;
        g = (g - 0.5) * cf + 0.5;
        b = (b - 0.5) * cf + 0.5;
        float cl2 = r * 0.2126 + g * 0.7152 + b * 0.0722;
        float cs = 1.0 + clarity * 0.25 * mm;
        r = mix(cl2, r, cs); g = mix(cl2, g, cs); b = mix(cl2, b, cs);
    }

    // ── Sharpness (local contrast enhancement — no neighbor sampling) ──
    if (sharpness != 0.0) {
        float sl = r * 0.2126 + g * 0.7152 + b * 0.0722;
        float sh = sharpness * 0.8;
        float edgeR = r - sl;
        float edgeG = g - sl;
        float edgeB = b - sl;
        r += edgeR * sh;
        g += edgeG * sh;
        b += edgeB * sh;
    }

    return half4(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), a);
}
`;

// Lazy shader compilation — deferred so native Skia module is fully ready
let _adjustShaderEffect: any = null;
let _shaderInitDone = false;
let _shaderLevel = '';
let _shaderDebug = '';

// ── Passthrough shader (absolute minimum — just returns the image pixel) ──
const SHADER_PASSTHROUGH = `
uniform shader image;
half4 main(float2 coord) {
  return image.eval(coord);
}
`;

// ── Basic shader (brightness + contrast + saturation only — no float4 uniforms) ──
const SHADER_BASIC = `
uniform shader image;
uniform float brightness;
uniform float contrast;
uniform float saturation;

half4 main(float2 coord) {
  float4 p = float4(image.eval(coord));
  float r = p.r;
  float g = p.g;
  float b = p.b;
  float a = p.a;

  if (brightness != 0.0) {
    float bf = pow(2.0, brightness * 1.5);
    r = r * bf;
    g = g * bf;
    b = b * bf;
  }

  if (contrast != 0.0) {
    r = (r - 0.5) * (1.0 + contrast) + 0.5;
    g = (g - 0.5) * (1.0 + contrast) + 0.5;
    b = (b - 0.5) * (1.0 + contrast) + 0.5;
  }

  if (saturation != 0.0) {
    float l = r * 0.2126 + g * 0.7152 + b * 0.0722;
    float sf = 1.0 + saturation;
    r = mix(l, r, sf);
    g = mix(l, g, sf);
    b = mix(l, b, sf);
  }

  return half4(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), a);
}
`;

function getShaderEffect() {
  if (_adjustShaderEffect) return _adjustShaderEffect;
  if (_shaderInitDone || !HAS_SKIA_MODULE) {
    if (!HAS_SKIA_MODULE) _shaderDebug = 'nomod';
    return null;
  }
  _shaderInitDone = true;

  // Level 1: Try full shader (all 13 adjustments + filter matrix)
  try {
    const r = SkiaObj.RuntimeEffect.Make(ADJUST_SHADER_SRC);
    if (r) { _adjustShaderEffect = r; _shaderLevel = 'FULL'; return r; }
    _shaderDebug += 'F0';
  } catch (e: any) { _shaderDebug += 'FE'; }

  // Level 2: Try basic shader (3 adjustments, no float4 uniforms)
  try {
    const r = SkiaObj.RuntimeEffect.Make(SHADER_BASIC);
    if (r) { _adjustShaderEffect = r; _shaderLevel = 'BASIC'; return r; }
    _shaderDebug += 'B0';
  } catch (e: any) { _shaderDebug += 'BE'; }

  // Level 3: Try passthrough (just returns image pixel — absolute minimum)
  try {
    const r = SkiaObj.RuntimeEffect.Make(SHADER_PASSTHROUGH);
    if (r) { _adjustShaderEffect = r; _shaderLevel = 'PASS'; return r; }
    _shaderDebug += 'P0';
  } catch (e: any) { _shaderDebug += 'PE'; }

  return null;
}
const HAS_SKIA = HAS_SKIA_MODULE; // module availability flag (shader checked lazily)

SplashScreen.preventAutoHideAsync();

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const STATUS_BAR_HEIGHT = Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

// Responsive breakpoints
const isSmallScreen = SCREEN_H < 700;
const isMediumScreen = SCREEN_H >= 700 && SCREEN_H < 800;
const BOTTOM_PANEL_HEIGHT = isSmallScreen ? 200 : isMediumScreen ? 230 : 260;
const CROP_PANEL_HEIGHT = isSmallScreen ? 280 : 310;
const HEADER_HEIGHT = isSmallScreen ? 48 : 56;
const CANVAS_HORIZONTAL_PADDING = 16;
const SAFE_HORIZONTAL_PADDING = 16;

type ElementType = 'image' | 'text';
interface CanvasElement { 
  id: string; type: ElementType; src?: string; content?: string; color?: string; 
  x: number; y: number; scale?: number; rotation?: number; 
  rotateX?: number; rotateY?: number; rotateZ?: number;
  fontFamily?: string; fontSize?: number; letterSpacing?: number; 
  width?: number; isBold?: boolean; isItalic?: boolean; isUnderline?: boolean;
  textAlign?: 'left' | 'center' | 'right'; lineHeight?: number; opacity?: number;
  shadowColor?: string; shadowBlur?: number; shadowDistance?: number; shadowAngle?: number; shadowOpacity?: number;
  strokeColor?: string; strokeWidth?: number;
  glowColor?: string; glowRadius?: number; glowOpacity?: number;
  isTintable?: boolean;
  behindSubject?: boolean;
  behindDepth?: number; // 0..1 — Photoshop-style "behind" depth: how much the subject covers the layer
  gradientAngle?: number;
  groupId?: string;
  isPremiumPack?: boolean;
  // Template: multi-line styled text stored as a single element
  templateLines?: { text: string; fontFamily: string; fontSize: number; color: string; letterSpacing?: number; isBold?: boolean; }[];
  // Curved text shape (per-character layout): C=arc, S=wave, O=circle
  textShape?: 'none' | 'arc' | 'wave' | 'circle';
  textCurveAmount?: number; // -100..100
  // Photoshop-style layer blend mode (applied on the layer wrapper)
  blendMode?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
}
interface PackData { id: string; name: string; isPremium?: boolean; stickers: { id: string; src: string; isTintable?: boolean; }[]; }
interface FontCategory { id: string; name: string; fonts: any[]; }

const IDENTITY_MATRIX = [1,0,0,0,0,  0,1,0,0,0,  0,0,1,0,0,  0,0,0,1,0];

const lerpMatrix = (filter: number[], t: number): number[] =>
  IDENTITY_MATRIX.map((v, i) => v + t * (filter[i] - v));



// ── Multi-layer filter builder ──
// Each filter is built by stacking: tone curve → color shift → cross-process → shadow/highlight tint → fade
// This mimics how real film stocks respond to light through multiple chemical layers


const FILTERS: { id: string; label: string; matrix: number[]; defaultStrength: number; previewColor: string }[] = [
  ...(require('./assets/filters-free.json') as { id: string; label: string; matrix: number[]; defaultStrength: number; previewColor: string }[]),
  ...(require('./assets/filters-pro.json')  as { id: string; label: string; matrix: number[]; defaultStrength: number; previewColor: string }[]),
];


const FILTER_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'kg', label: 'Kodak Gold' },
  { id: 'fs', label: 'Fuji Superia' },
  { id: 'av', label: 'Agfa' },
  { id: 'il', label: 'Ilford' },
  { id: 'vr', label: 'VHS/Retro' },
  { id: 'bw', label: 'B&W' },
  { id: 'filmstock', label: '✨ Film Stocks' },
  { id: 'pro_cin', label: '✨ Cinematic' },
  { id: 'pro_pt', label: '✨ Portrait' },
  { id: 'pro_fd', label: '✨ Food' },
  { id: 'pro_tr', label: '✨ Travel' },
  { id: 'pro_md', label: '✨ Moody' },
  { id: 'pro_fx', label: '✨ Light FX' },
];

const ADJUST_TOOLS: { key: string; icon: string; label: string; min: number; max: number; step: number; group: string }[] = [
  { key: 'brightness', icon: 'wb-sunny',            label: 'Brightness', min: -1, max: 1, step: 0.05, group: 'Light' },
  { key: 'contrast',   icon: 'contrast',            label: 'Contrast',   min: -1, max: 1, step: 0.05, group: 'Light' },
  { key: 'highlights', icon: 'light-mode',          label: 'Highlights', min: -1, max: 1, step: 0.05, group: 'Light' },
  { key: 'shadows',    icon: 'dark-mode',           label: 'Shadows',    min: -1, max: 1, step: 0.05, group: 'Light' },
  { key: 'fade',       icon: 'cloud',               label: 'Fade',       min:  0, max: 1, step: 0.05, group: 'Light' },
  { key: 'dehaze',     icon: 'landscape',           label: 'Dehaze',     min: -1, max: 1, step: 0.05, group: 'Light' },
  { key: 'saturation', icon: 'palette',             label: 'Saturation', min: -1, max: 1, step: 0.05, group: 'Color' },
  { key: 'vibrance',   icon: 'filter-vintage',      label: 'Vibrance',   min: -1, max: 1, step: 0.05, group: 'Color' },
  { key: 'temp',       icon: 'thermostat',          label: 'Temp',       min: -1, max: 1, step: 0.05, group: 'Color' },
  { key: 'tint',       icon: 'water-drop',          label: 'Tint',       min: -1, max: 1, step: 0.05, group: 'Color' },
  { key: 'clarity',    icon: 'hdr-strong',          label: 'Clarity',    min: -1, max: 1, step: 0.05, group: 'Detail' },
  { key: 'sharpness',  icon: 'center-focus-strong', label: 'Sharpness',  min: -1, max: 1, step: 0.05, group: 'Detail' },
];

// HSL channel definitions
const HSL_CHANNELS = [
  { key: 'Red', color: '#FF4444' }, { key: 'Orange', color: '#FF8C00' },
  { key: 'Yellow', color: '#FFD700' }, { key: 'Green', color: '#22C55E' },
  { key: 'Aqua', color: '#06B6D4' }, { key: 'Blue', color: '#3B82F6' },
  { key: 'Purple', color: '#8B5CF6' }, { key: 'Magenta', color: '#EC4899' },
] as const;

const DEFAULT_HSL: Record<string, [number, number, number]> = {
  Red: [0,0,0], Orange: [0,0,0], Yellow: [0,0,0], Green: [0,0,0],
  Aqua: [0,0,0], Blue: [0,0,0], Purple: [0,0,0], Magenta: [0,0,0],
};

// 17-point identity curve (linear 0→1)
const IDENTITY_CURVE_17 = Array.from({ length: 17 }, (_, i) => i / 16);

// ── Monotone cubic Hermite interpolation (Fritsch-Carlson) ──
// Produces smooth curves that NEVER overshoot between control points.
// controlPts: array of {x, y} sorted by x, normalized 0→1
// Returns a 17-point LUT
const monotoneInterpolateLUT = (controlPts: { x: number; y: number }[]): number[] => {
  const pts = [...controlPts].sort((a, b) => a.x - b.x);
  const n = pts.length;
  if (n === 0) return [...IDENTITY_CURVE_17];
  if (n === 1) return Array(17).fill(pts[0].y);

  // Step 1: Compute deltas and slopes
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = []; // slopes at each point
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    dy.push(pts[i + 1].y - pts[i].y);
  }
  const slopes: number[] = dx.map((d, i) => d === 0 ? 0 : dy[i] / d);

  // Step 2: Fritsch-Carlson tangents
  m.push(slopes[0] || 0);
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      m.push(0); // sign change → flat tangent (prevents overshoot)
    } else {
      m.push((slopes[i - 1] + slopes[i]) / 2);
    }
  }
  m.push(slopes[n - 2] || 0);

  // Step 3: Enforce monotonicity constraints
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(slopes[i]) < 1e-10) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / slopes[i];
      const beta = m[i + 1] / slopes[i];
      // Restrict to circle of radius 3
      const mag = Math.sqrt(alpha * alpha + beta * beta);
      if (mag > 3) {
        const tau = 3 / mag;
        m[i] = tau * alpha * slopes[i];
        m[i + 1] = tau * beta * slopes[i];
      }
    }
  }

  // Step 4: Evaluate Hermite at 17 uniform points
  const lut: number[] = [];
  for (let li = 0; li < 17; li++) {
    const x = li / 16;
    // Find segment
    let seg = 0;
    for (let i = 0; i < n - 1; i++) {
      if (x >= pts[i].x) seg = i;
    }
    if (x <= pts[0].x) { lut.push(Math.max(0, Math.min(1, pts[0].y))); continue; }
    if (x >= pts[n - 1].x) { lut.push(Math.max(0, Math.min(1, pts[n - 1].y))); continue; }

    const h = dx[seg] || 1e-6;
    const t = (x - pts[seg].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    // Hermite basis
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const val = h00 * pts[seg].y + h10 * h * m[seg] + h01 * pts[seg + 1].y + h11 * h * m[seg + 1];
    lut.push(Math.max(0, Math.min(1, val)));
  }
  return lut;
};

// SVG path from control points using monotone Hermite (tight, no overshoot)
const smoothCurvePath = (controlPts: { x: number; y: number }[], size: number): string => {
  const pts = [...controlPts].sort((a, b) => a.x - b.x);
  const n = pts.length;
  if (n < 2) return '';

  // Compute monotone tangents (same Fritsch-Carlson as LUT)
  const dx: number[] = [];
  const dy: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    dy.push(pts[i + 1].y - pts[i].y);
  }
  const slopes = dx.map((d, i) => d === 0 ? 0 : dy[i] / d);
  const m: number[] = [slopes[0] || 0];
  for (let i = 1; i < n - 1; i++) {
    m.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
  }
  m.push(slopes[n - 2] || 0);
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(slopes[i]) < 1e-10) { m[i] = 0; m[i + 1] = 0; } else {
      const a = m[i] / slopes[i], b = m[i + 1] / slopes[i];
      const mag = Math.sqrt(a * a + b * b);
      if (mag > 3) { const tau = 3 / mag; m[i] = tau * a * slopes[i]; m[i + 1] = tau * b * slopes[i]; }
    }
  }

  // Convert Hermite tangents to cubic bezier control points
  const toSvg = (v: { x: number; y: number }) => ({ x: v.x * size, y: (1 - v.y) * size });
  const p0 = toSvg(pts[0]);
  let d = `M ${p0.x} ${p0.y}`;
  for (let i = 0; i < n - 1; i++) {
    const seg = dx[i] || 1e-6;
    const cp1 = toSvg({ x: pts[i].x + seg / 3, y: pts[i].y + m[i] * seg / 3 });
    const cp2 = toSvg({ x: pts[i + 1].x - seg / 3, y: pts[i + 1].y - m[i + 1] * seg / 3 });
    const end = toSvg(pts[i + 1]);
    d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
  }
  return d;
};

// User Preset type
interface UserPreset {
  id: string;
  name: string;
  createdAt: number;
  adjustments: Record<string, number>;
  filterId: string;
  filterStrength: number;
  hsl: Record<string, [number, number, number]>;
  curveR: number[];
  curveG: number[];
  curveB: number[];
  curveMaster: number[];
}

// Text design template type
interface TextDesignTemplate {
  id: string;
  name: string;
  category: string;
  lines: { text: string; fontFamily: string; fontSize: number; color: string; letterSpacing?: number; isBold?: boolean; }[];
}



const CLOUD_DATABASE_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/stickers/sticker-packs.json';
const CLOUD_FONTS_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/fonts.json';
const SPLASH_LOGO_URL = `https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/logos/Achhu%20Kannada%20LOGO.png?v=${Date.now()}`;
const CLOUD_TEXT_PRESETS_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/textPresets.json';
const CLOUD_SPLASH_TEXT_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/splashText.json';
const CLOUD_COLORS_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/colors.json';
const APP_BG_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/backgrounds/BG.webp';
const CLOUD_GRADIENTS_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/gradients.json';
const CLOUD_FREE_FILTERS_URL   = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/filters-free.json';
const CLOUD_PRO_FILTERS_URL    = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/filters-pro.json';
const CLOUD_TEXT_DESIGN_TEMPLATES_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/textDesignTemplates.json';
const CLOUD_SPLASH_CONFIG_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/backgrounds/splashConfig.json';
const CLOUD_PAYWALL_CONFIG_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/paywall-config.json';
const CLOUD_EXPORT_CONFIG_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/export-config.json';
const CLOUD_DESIGNER_TEMPLATES_URL2 = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/designer-templates.json';

const fixGithubUrl = (url: string) => url.replace(
  /raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?!refs\/heads\/)(.+)/,
  'raw.githubusercontent.com/$1/$2/refs/heads/$3'
);

const CACHE_TTL = 0; // Always fetch fresh on launch, fallback to cache if offline
const FETCH_TIMEOUT = 10000; // 10 seconds

const fetchWithTimeout = (url: string, opts: RequestInit = {}, timeout = FETCH_TIMEOUT): Promise<Response> => {
  const controller = new AbortController();
  const existingSignal = opts.signal;
  const timer = setTimeout(() => controller.abort(), timeout);
  if (existingSignal) existingSignal.addEventListener('abort', () => controller.abort());
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const cachedFetch = async (url: string, cacheKey: string, signal?: AbortSignal): Promise<any> => {
  let cachedData: any = null;
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      cachedData = data;
      if (CACHE_TTL > 0 && Date.now() - ts < CACHE_TTL) return data;
    }
  } catch {}
  try {
    const res = await fetchWithTimeout(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    try { await AsyncStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() })); } catch {}
    return data;
  } catch (err) {
    if (cachedData) return cachedData; // Offline fallback to stale cache
    throw err;
  }
};

const THEME = { 
  bgBase: '#000000',       
  bgSurface: '#18191B',    
  bgSurfaceHigh: '#2a2b2e',
  bgControl: '#2a2b2e',    
  primary: '#DDC616',
  primaryContainer: '#3d3708',
  onPrimaryContainer: '#f5e66a',
  secondaryContainer: '#242526',
  error: '#CF6679',        
  textMain: '#FFFFFF', 
  textMuted: '#888888', 
  outline: '#3a3b3e',
  border: '#2a2b2e', 
  handle: '#FFFFFF', 
  guideLine: '#DDC616',    
  snapSuccess: '#DDC616',  
  boundingBox: '#DDC616'   
};
const COLOR_PALETTE = ['#FFFFFF', '#F4F4F5', '#9CA3AF', '#3F3F46', '#000000', THEME.primary, '#F59E0B', THEME.error, '#EC4899', '#8B5CF6', '#3B82F6', '#06B6D4', '#10B981', '#22C55E', '#84CC16'];

const DEFAULT_COLOR_CATEGORIES: { id: string; label: string; colors: string[]; isPro?: boolean }[] = [
  { id: 'basic', label: 'Basic', colors: ['#FFFFFF', '#F4F4F5', '#D4D4D8', '#A1A1AA', '#71717A', '#52525B', '#3F3F46', '#27272A', '#18181B', '#000000'] },
  { id: 'warm', label: 'Warm', colors: ['#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24', '#F59E0B', '#D97706', '#B45309', '#92400E', '#78350F', '#451A03'] },
  { id: 'red', label: 'Red', colors: ['#FEE2E2', '#FECACA', '#FCA5A5', '#F87171', '#EF4444', '#DC2626', '#B91C1C', '#991B1B', '#7F1D1D', '#450A0A'] },
  { id: 'pink', label: 'Pink', colors: ['#FCE7F3', '#FBCFE8', '#F9A8D4', '#F472B6', '#EC4899', '#DB2777', '#BE185D', '#9D174D', '#831843', '#500724'] },
  { id: 'purple', label: 'Purple', colors: ['#F3E8FF', '#E9D5FF', '#D8B4FE', '#C084FC', '#A855F7', '#9333EA', '#7C3AED', '#6D28D9', '#5B21B6', '#3B0764'] },
  { id: 'blue', label: 'Blue', colors: ['#DBEAFE', '#BFDBFE', '#93C5FD', '#60A5FA', '#3B82F6', '#2563EB', '#1D4ED8', '#1E40AF', '#1E3A8A', '#172554'] },
  { id: 'cool', label: 'Cool', colors: ['#CFFAFE', '#A5F3FC', '#67E8F9', '#22D3EE', '#06B6D4', '#0891B2', '#0E7490', '#155E75', '#164E63', '#083344'] },
  { id: 'green', label: 'Green', colors: ['#DCFCE7', '#BBF7D0', '#86EFAC', '#4ADE80', '#22C55E', '#16A34A', '#15803D', '#166534', '#14532D', '#052E16'] },
  { id: 'neon', label: 'Neon', colors: ['#FF0000', '#FF4500', '#FF6600', '#FFAA00', '#FFE600', '#AAFF00', '#00FF00', '#00FFAA', '#00FFFF', '#AA00FF'] },
  { id: 'pastel', label: 'Pastel', colors: ['#FECDD3', '#FED7AA', '#FEF08A', '#BBF7D0', '#A7F3D0', '#BAE6FD', '#C7D2FE', '#DDD6FE', '#FBCFE8', '#E2E8F0'] },
  { id: 'gradient', label: '✨ Gradient', colors: [
    'gradient:#FF6B6B,#FFE66D', 'gradient:#FF9A9E,#FECFEF', 'gradient:#A18CD1,#FBC2EB',
    'gradient:#FAD0C4,#FFD1FF', 'gradient:#FFECD2,#FCB69F', 'gradient:#FF9A9E,#FECFEF',
    'gradient:#667EEA,#764BA2', 'gradient:#F093FB,#F5576C', 'gradient:#4FACFE,#00F2FE',
    'gradient:#43E97B,#38F9D7', 'gradient:#FA709A,#FEE140', 'gradient:#A8EDEA,#FED6E3',
    'gradient:#FF0844,#FFB199', 'gradient:#F7971E,#FFD200', 'gradient:#00C9FF,#92FE9D',
    'gradient:#FC5C7D,#6A82FB', 'gradient:#11998E,#38EF7D', 'gradient:#C471F5,#FA71CD',
    'gradient:#F5AF19,#F12711', 'gradient:#3494E6,#EC6EAD',
  ] },
];

const hsvToHex = (h: number, s: number, v: number): string => {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

const PRESET_COLORS = ['#DDC616', '#FF4444', '#FFFFFF', '#F59E0B', '#EC4899', '#8B5CF6', '#3B82F6', '#06B6D4', '#10B981', '#F44336', '#22C55E', '#84CC16'];
const PRESET_FONTS = ['Padyakke', 'ATSSmooth', 'Hubballi', 'NotoSans'];
const randomPresetStyle = (idx: number, availableFonts?: string[]) => {
  const color = PRESET_COLORS[idx % PRESET_COLORS.length];
  const fonts = availableFonts && availableFonts.length > 0 ? availableFonts : PRESET_FONTS;
  const font = fonts[Math.floor(Math.random() * fonts.length)];
  const fontSize = 30 + Math.floor(Math.random() * 26);
  const letterSpacing = Math.floor(Math.random() * 4);
  const hasShadow = Math.random() > 0.4;
  return { color, font, fontSize, letterSpacing, shadowBlur: hasShadow ? 3 + Math.floor(Math.random() * 7) : 0, shadowDistance: hasShadow ? 2 + Math.floor(Math.random() * 4) : 0, shadowOpacity: hasShadow ? 0.4 + Math.random() * 0.4 : 0 };
};

const CORE_FONTS = [ 
  { label: 'BLR Smooth', value: 'ATSSmooth', boldValue: 'ATSSmooth' }, 
  { label: 'Hubballi', value: 'Hubballi', boldValue: 'Hubballi' }, 
  { label: 'Noto Sans', value: 'NotoSans', boldValue: 'NotoSans' }, 
  { label: 'Padyakke', value: 'Padyakke', boldValue: 'Padyakke' }, 
];

const hexToRgba = (hex: string, opacity: number) => {
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

const CustomSlider = ({ value, min, max, step, onChange, onStart, onComplete, onScrollLock }: any) => {
  const [isActive, setIsActive] = useState(false);
  const widthRef = useRef(0);
  const valRef = useRef(value);
  const startValRef = useRef(value);
  const activatedRef = useRef(false);
  const propsRef = useRef({ min, max, step, range: max - min });
  const onScrollLockRef = useRef(onScrollLock);
  const onStartRef = useRef(onStart);
  const onCompleteRef = useRef(onComplete);
  const onChangeRef = useRef(onChange);

  valRef.current = value;
  propsRef.current = { min, max, step, range: max - min };
  onScrollLockRef.current = onScrollLock;
  onStartRef.current = onStart;
  onCompleteRef.current = onComplete;
  onChangeRef.current = onChange;

  const percentage = propsRef.current.range > 0 ? (value - propsRef.current.min) / propsRef.current.range : 0;

  const snapToValue = (pageX: number, layoutX: number) => {
    const w = widthRef.current;
    const x = Math.max(0, Math.min(w, pageX - layoutX - 4));
    const { min, max, step } = propsRef.current;
    let val = min + (x / w) * (max - min);
    if (step) val = Math.round(val / step) * step;
    return Math.max(min, Math.min(max, val));
  };

  const layoutXRef = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 3,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startValRef.current = valRef.current;
        activatedRef.current = true;
        layoutXRef.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        setIsActive(true);
        if (onScrollLockRef.current) onScrollLockRef.current(false);
        if (onStartRef.current) onStartRef.current();
      },
      onPanResponderMove: (e, gesture) => {
        if (widthRef.current === 0) return;
        const { min, max, step, range } = propsRef.current;
        const ratio = gesture.dx / widthRef.current;
        let newValue = startValRef.current + (ratio * range);
        let clamped = Math.max(min, Math.min(max, newValue));
        if (step) clamped = Math.round(clamped / step) * step;
        onChangeRef.current(clamped);
      },
      onPanResponderRelease: (e, gesture) => {
        // Tap-to-seek: only if no significant drag movement
        if (Math.abs(gesture.dx) < 4 && Math.abs(gesture.dy) < 4) {
          const tapped = snapToValue(e.nativeEvent.pageX, layoutXRef.current);
          onChangeRef.current(tapped);
        }
        setIsActive(false);
        if (onScrollLockRef.current) onScrollLockRef.current(true);
        if (activatedRef.current && onCompleteRef.current) onCompleteRef.current();
        activatedRef.current = false;
      },
      onPanResponderTerminate: () => {
        setIsActive(false);
        if (onScrollLockRef.current) onScrollLockRef.current(true);
        if (activatedRef.current && onCompleteRef.current) onCompleteRef.current();
        activatedRef.current = false;
      }
    })
  ).current;

  const TRACK_H = 28;
  const THUMB_W = 32;
  const THUMB_H = TRACK_H + 4;
  const RADIUS = TRACK_H / 2;

  return (
    <View 
      style={{ height: THUMB_H + 10, justifyContent: 'center', marginVertical: 2, paddingHorizontal: 4 }} 
      onLayout={e => { widthRef.current = e.nativeEvent.layout.width - 8; }}
      {...panResponder.panHandlers}
    >
      {/* Track background (unfilled) */}
      <View style={{ position: 'absolute', left: 4, right: 4, height: TRACK_H, borderRadius: RADIUS, backgroundColor: 'rgba(221, 198, 22, 0.12)' }} />
      {/* Track filled */}
      <View style={{ position: 'absolute', left: 4, width: `${Math.max(percentage * 100, 0.5)}%`, height: TRACK_H, borderRadius: RADIUS, backgroundColor: THEME.primary }} />
      {/* Thumb - uses percentage left so it works even before onLayout fires */}
      <View style={{
        position: 'absolute',
        left: `${Math.max(percentage * 100, 0)}%`,
        marginLeft: 4 - THUMB_W / 2,
        width: THUMB_W,
        height: THUMB_H,
        borderRadius: 10,
        backgroundColor: '#2a2b2e',
        borderWidth: 2.5,
        borderColor: isActive ? THEME.primary : 'rgba(221, 198, 22, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        gap: 2.5,
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 3,
      }}>
        {/* Grip lines */}
        <View style={{ width: 1.5, height: 12, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />
        <View style={{ width: 1.5, height: 12, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />
        <View style={{ width: 1.5, height: 12, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />
        <View style={{ width: 1.5, height: 12, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />
        <View style={{ width: 1.5, height: 12, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />
      </View>
    </View>
  );
};

const ProSlider = ({ icon, label, value, min, max, step, onChange, onStart, onComplete, displayValue, onScrollLock }: any) => (
  <View style={styles.proSliderWrapper}>
    <View style={styles.proSliderHeader}>
      <Text style={styles.proSliderLabel}>{label}</Text>
      <Text style={styles.proSliderValue}>{displayValue !== undefined ? displayValue : value}</Text>
    </View>
    <CustomSlider min={min} max={max} step={step} value={value} onStart={onStart} onChange={onChange} onComplete={onComplete} onScrollLock={onScrollLock} />
  </View>
);

const DraggableBackground = React.memo(({ src, imgDim, canvasW, canvasH, isLocked, forceColorMatrix, glCaptureUri, glEditorRefProp, filterMatrix, filterStrength, filterPreviewColor, brightness, contrast, highlights, shadows, temp, tint, fade, dehaze, saturation, vibrance, clarity, sharpness, hslValues, curveR, curveG, curveB, curveMaster, extraTransform, onTransformChange }: any) => {
  const [, setRenderTick] = useState(0);
  const baseScaleRef = useRef(Math.max(canvasW / imgDim.w, canvasH / imgDim.h));
  const transform = useRef({ x: 0, y: 0, scale: baseScaleRef.current }).current;
  const gesture = useRef({ startX: 0, startY: 0, lastX: 0, lastY: 0, pointers: 0, initialDist: 0, lastScale: baseScaleRef.current }).current;
  const dimsRef = useRef({ canvasW, canvasH, imgW: imgDim.w, imgH: imgDim.h });
  const prevImgDimRef = useRef(imgDim);
  const onTransformChangeRef = useRef(onTransformChange);
  useEffect(() => { onTransformChangeRef.current = onTransformChange; });

  // ── GL shader pipeline (replaces Skia) ──
  const [glReady, setGlReady] = useState(false);
  const [glFailed, setGlFailed] = useState(false);
  const useGL = !glFailed && !forceColorMatrix;
  const glEditorRef = useRef<GLImageEditorHandle>(null);
  // Expose GL capture to parent (for export flow)
  useEffect(() => { if (glEditorRefProp) glEditorRefProp.current = glEditorRef.current; });

  const glUniforms = useMemo<GLEditorUniforms>(() => ({
    brightness: brightness || 0,
    contrast: contrast || 0,
    highlights: highlights || 0,
    shadows: shadows || 0,
    saturation: saturation || 0,
    vibrance: vibrance || 0,
    temp: temp || 0,
    tint: tint || 0,
    fade: fade || 0,
    dehaze: dehaze || 0,
    clarity: clarity || 0,
    sharpness: sharpness || 0,
    grain: 0,
    grainSize: 0,
    grainRoughness: 0,
    grainColor: 0,
    filterStrength: filterStrength || 0,
    filterMatrix: filterMatrix || null,
    hslRed: hslValues?.Red || [0,0,0],
    hslOrange: hslValues?.Orange || [0,0,0],
    hslYellow: hslValues?.Yellow || [0,0,0],
    hslGreen: hslValues?.Green || [0,0,0],
    hslAqua: hslValues?.Aqua || [0,0,0],
    hslBlue: hslValues?.Blue || [0,0,0],
    hslPurple: hslValues?.Purple || [0,0,0],
    hslMagenta: hslValues?.Magenta || [0,0,0],
    curveR: curveR || IDENTITY_CURVE_17,
    curveG: curveG || IDENTITY_CURVE_17,
    curveB: curveB || IDENTITY_CURVE_17,
    curveMaster: curveMaster || IDENTITY_CURVE_17,
  }), [filterMatrix, filterStrength, brightness, contrast, highlights, shadows, saturation, vibrance, temp, tint, fade, dehaze, clarity, sharpness, hslValues, curveR, curveG, curveB, curveMaster]);

  // ── Sync transform to current canvas/image DURING RENDER (not in effect) ──
  // This prevents a one-frame "jump/zoom" after applyCrop: when imgDim changes,
  // the previous pinch-zoom scale in `transform` would otherwise get applied to
  // the new image for one frame before useEffect corrected it.
  {
    const prevDims = dimsRef.current;
    const imgChanged = prevImgDimRef.current !== imgDim;
    const canvasChanged = prevDims.canvasW !== canvasW || prevDims.canvasH !== canvasH;
    if (imgChanged || canvasChanged) {
      const newBase = Math.max(canvasW / imgDim.w, canvasH / imgDim.h);
      baseScaleRef.current = newBase;
      dimsRef.current = { canvasW, canvasH, imgW: imgDim.w, imgH: imgDim.h };
      prevImgDimRef.current = imgDim;
      if (imgChanged) {
        // New image loaded or crop applied — full reset synchronously
        transform.scale = newBase; transform.x = 0; transform.y = 0;
        gesture.lastX = 0; gesture.lastY = 0; gesture.lastScale = newBase;
      } else {
        // Only canvas size changed — preserve position, just clamp
        if (transform.scale < newBase) { transform.scale = newBase; gesture.lastScale = newBase; }
        const boundX = Math.max(0, (imgDim.w * transform.scale - canvasW) / 2);
        const boundY = Math.max(0, (imgDim.h * transform.scale - canvasH) / 2);
        transform.x = Math.max(-boundX, Math.min(transform.x, boundX));
        transform.y = Math.max(-boundY, Math.min(transform.y, boundY));
        gesture.lastX = transform.x; gesture.lastY = transform.y;
      }
    }
  }

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => { const t = e.nativeEvent.touches; gesture.pointers = t.length; if (t.length === 1) { gesture.startX = t[0].pageX; gesture.startY = t[0].pageY; gesture.lastX = transform.x; gesture.lastY = transform.y; } },
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      const minScale = baseScaleRef.current;
      const { canvasW: cW, canvasH: cH, imgW, imgH } = dimsRef.current;
      if (gesture.pointers === 2 && t.length === 1) { gesture.pointers = 1; gesture.startX = t[0].pageX; gesture.startY = t[0].pageY; gesture.lastX = transform.x; gesture.lastY = transform.y; return; }
      if (gesture.pointers === 1 && t.length === 2) { gesture.pointers = 2; const dx = t[0].pageX - t[1].pageX; const dy = t[0].pageY - t[1].pageY; gesture.initialDist = Math.max(1, Math.hypot(dx, dy)); gesture.lastScale = transform.scale; return; }
      gesture.pointers = t.length;
      let newX = gesture.lastX; let newY = gesture.lastY;
      if (t.length === 1) { newX = gesture.lastX + (t[0].pageX - gesture.startX); newY = gesture.lastY + (t[0].pageY - gesture.startY); } 
      else if (t.length === 2) { const dist = Math.max(1, Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY));
        transform.scale = Math.max(minScale, Math.min(gesture.lastScale * (dist / gesture.initialDist), 10));
        newX = transform.x; newY = transform.y; }
        const boundX = Math.max(0, (imgW * transform.scale - cW) / 2); const boundY = Math.max(0, (imgH * transform.scale - cH) / 2);
        transform.x = Math.max(-boundX, Math.min(newX, boundX)); transform.y = Math.max(-boundY, Math.min(newY, boundY));
        setRenderTick(t => t + 1);
      },
      onPanResponderRelease: () => { gesture.pointers = 0; gesture.lastX = transform.x; gesture.lastY = transform.y; gesture.lastScale = transform.scale; onTransformChangeRef.current?.({ x: transform.x, y: transform.y, scale: transform.scale, baseScale: baseScaleRef.current }); }
    })).current;

    // Color matrix fallback (always computed — used when Skia image not ready)
    const adjustmentMatrix = useMemo(() => {
      const matrices: any[] = [];

      // ── Filter: apply film look first (before user adjustments) ──
      if (filterMatrix && filterStrength > 0) {
        matrices.push(lerpMatrix(filterMatrix, filterStrength));
      }

      // ── Brightness: additive with highlight protection (matches GL shader) ──
      if (brightness !== 0) {
        const br = brightness * 0.25;
        // Linear approximation of GL's highlight-protecting additive brightness
        // GL: r += br * (1.0 - r*0.7) → gain = (1 - br*0.7), offset = br
        // For negative: r += br * (0.3 + r*0.7) → gain = (1 + br*0.7), offset = br*0.3
        if (br > 0) {
          const gain = 1 - br * 0.7;
          matrices.push([
            gain, 0, 0, 0, br,
            0, gain, 0, 0, br,
            0, 0, gain, 0, br,
            0, 0, 0, 1, 0,
          ]);
        } else {
          const gain = 1 + br * 0.7;
          matrices.push([
            gain, 0, 0, 0, br * 0.3,
            0, gain, 0, 0, br * 0.3,
            0, 0, gain, 0, br * 0.3,
            0, 0, 0, 1, 0,
          ]);
        }
      }

      // ── Contrast: scale around 0.5 midpoint (matches GL shader) ──
      if (contrast !== 0) {
        const c = 1 + contrast * 0.35;
        const t = 0.5 * (1 - c);
        matrices.push([
          c, 0, 0, 0, t,
          0, c, 0, 0, t,
          0, 0, c, 0, t,
          0, 0, 0, 1, 0,
        ]);
      }

      // ── Highlights: gain + offset approximating GL smoothstep masking ──
      if (highlights !== 0) {
        const h = highlights * 0.25;
        matrices.push([
          1 + h, 0, 0, 0, -h * 0.5,
          0, 1 + h, 0, 0, -h * 0.5,
          0, 0, 1 + h, 0, -h * 0.5,
          0, 0, 0, 1, 0,
        ]);
      }

      // ── Shadows: offset + gain approximating GL smoothstep masking ──
      if (shadows !== 0) {
        const s = shadows * 0.25;
        matrices.push([
          1 - s * 0.3, 0, 0, 0, s * 0.35,
          0, 1 - s * 0.3, 0, 0, s * 0.35,
          0, 0, 1 - s * 0.3, 0, s * 0.35,
          0, 0, 0, 1, 0,
        ]);
      }

      // ── Fade: lift blacks (matches GL shader) ──
      if (fade > 0) {
        const fl = fade * 0.15;
        const fm = fade * 0.06;
        matrices.push([
          1 - fm, 0, 0, 0, fl + fm * 0.5,
          0, 1 - fm, 0, 0, fl + fm * 0.5,
          0, 0, 1 - fm, 0, fl + fm * 0.5,
          0, 0, 0, 1, 0,
        ]);
      }

      // ── Dehaze: contrast + saturation + shadow darkening (matches GL shader) ──
      if (dehaze !== 0) {
        // Contrast (GL uses 0.3 coefficient)
        const dc = 1 + dehaze * 0.3;
        const dOffset = (1 - dc) * 0.5;
        matrices.push([
          dc, 0, 0, 0, dOffset,
          0, dc, 0, 0, dOffset,
          0, 0, dc, 0, dOffset,
          0, 0, 0, 1, 0,
        ]);
        // Saturation boost (GL uses 0.15)
        const ds = 1 + dehaze * 0.15;
        const lr = 0.2126, lg = 0.7152, lb = 0.0722;
        const dsr = (1 - ds) * lr, dsg = (1 - ds) * lg, dsb = (1 - ds) * lb;
        matrices.push([
          dsr + ds, dsg, dsb, 0, 0,
          dsr, dsg + ds, dsb, 0, 0,
          dsr, dsg, dsb + ds, 0, 0,
          0, 0, 0, 1, 0,
        ]);
        // Darken shadows (GL uses 0.05)
        if (dehaze > 0) {
          matrices.push([
            1, 0, 0, 0, -dehaze * 0.05,
            0, 1, 0, 0, -dehaze * 0.05,
            0, 0, 1, 0, -dehaze * 0.05,
            0, 0, 0, 1, 0,
          ]);
        }
      }

      // ── Saturation: Rec.709 luminance-preserving (matches GL shader coefficient) ──
      if (saturation !== 0) {
        const s = 1 + saturation * 0.5;
        const lr = 0.2126, lg = 0.7152, lb = 0.0722;
        const sr = (1 - s) * lr, sg = (1 - s) * lg, sb = (1 - s) * lb;
        matrices.push([
          sr + s, sg, sb, 0, 0,
          sr, sg + s, sb, 0, 0,
          sr, sg, sb + s, 0, 0,
          0, 0, 0, 1, 0,
        ]);
      }

      // ── Vibrance: uniform saturation boost approximating GL selective vibrance ──
      if (vibrance !== 0) {
        const v = 1 + vibrance * 0.35;
        const lr = 0.2126, lg = 0.7152, lb = 0.0722;
        const vr = (1 - v) * lr, vg = (1 - v) * lg, vb = (1 - v) * lb;
        matrices.push([
          vr + v, vg, vb, 0, 0,
          vr, vg + v, vb, 0, 0,
          vr, vg, vb + v, 0, 0,
          0, 0, 0, 1, 0,
        ]);
      }

      // ── Temperature: warm/cool white balance (matches GL shader) ──
      if (temp !== 0) {
        const tw = temp * 0.08;
        matrices.push([
          1, 0, 0, 0, tw,
          0, 1, 0, 0, tw * 0.02,
          0, 0, 1, 0, -tw,
          0, 0, 0, 1, 0,
        ]);
      }

      // ── Tint: green-magenta shift (matches GL shader) ──
      if (tint !== 0) {
        const ti = tint * 0.06;
        matrices.push([
          1, 0, 0, 0, ti,
          0, 1, 0, 0, -Math.abs(ti) * 0.8,
          0, 0, 1, 0, ti,
          0, 0, 0, 1, 0,
        ]);
      }

      // ── Clarity: midtone contrast + saturation (matches GL shader) ──
      if (clarity !== 0) {
        // GL applies clarity * 0.2 midtone-weighted contrast + 0.08 saturation
        const cc = 1 + clarity * 0.2;
        const co = (1 - cc) * 0.5;
        matrices.push([
          cc, 0, 0, 0, co,
          0, cc, 0, 0, co,
          0, 0, cc, 0, co,
          0, 0, 0, 1, 0,
        ]);
        const cs = 1 + clarity * 0.08;
        const lr = 0.2126, lg = 0.7152, lb = 0.0722;
        const csr = (1 - cs) * lr, csg = (1 - cs) * lg, csb = (1 - cs) * lb;
        matrices.push([
          csr + cs, csg, csb, 0, 0,
          csr, csg + cs, csb, 0, 0,
          csr, csg, csb + cs, 0, 0,
          0, 0, 0, 1, 0,
        ]);
      }

      // ── Sharpness: subtle contrast (GL uses spatial unsharp mask, approx with contrast) ──
      if (sharpness !== 0) {
        const sc = 1 + sharpness * 0.15;
        const so = (1 - sc) * 0.5;
        matrices.push([
          sc, 0, 0, 0, so,
          0, sc, 0, 0, so,
          0, 0, sc, 0, so,
          0, 0, 0, 1, 0,
        ]);
      }

      if (matrices.length === 0) return null;
      if (matrices.length === 1) return matrices[0];
      return concatColorMatrices(...matrices);
    }, [filterMatrix, filterStrength, brightness, contrast, highlights, shadows, saturation, vibrance, temp, tint, fade, dehaze, clarity, sharpness]);

    const imageElement = <Image source={{ uri: src }} style={{ width: imgDim.w, height: imgDim.h }} />;

    // Fallback layer: always rendered (hidden behind GL) so Image is pre-loaded for export capture
    const fallbackLayer = adjustmentMatrix && HAS_COLOR_MATRIX ? (
      <ColorMatrix matrix={adjustmentMatrix as any}>{imageElement}</ColorMatrix>
    ) : imageElement;

    // If a GL-captured frame is provided (export flow), render that directly with
    // NO color matrix / NO GLView — it already contains all baked-in effects. This
    // ensures ViewShot captures the exact pixels the user saw on screen.
    if (glCaptureUri) {
      return (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={{ transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.scale }, ...(extraTransform || [])] }}>
            <Image source={{ uri: glCaptureUri }} style={{ width: imgDim.w, height: imgDim.h }} />
          </View>
        </View>
      );
    }

    return (
      <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]} {...(isLocked ? {} : panResponder.panHandlers)}>
        <View style={{ transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.scale }, ...(extraTransform || [])] }}>
          {/* Always render the fallback Image/ColorMatrix so it is pre-loaded for export */}
          {fallbackLayer}
          {/* Primary: GL GPU shader pipeline — rendered on top when active */}
          {useGL && (
            <View style={StyleSheet.absoluteFill}>
              <GLImageEditor
                ref={glEditorRef}
                src={src}
                width={imgDim.w}
                height={imgDim.h}
                uniforms={glUniforms}
                onReady={() => setGlReady(true)}
                onError={() => setGlFailed(true)}
              />
            </View>
          )}

          {/* Overlay fallback when neither GL nor color matrix is available (Expo Go) */}
          {glFailed && !HAS_COLOR_MATRIX && (
            <>
              {brightness !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: brightness > 0 ? '#FFFFFF' : '#000000', opacity: Math.abs(brightness) * 0.5, pointerEvents: 'none' }]} />}
              {contrast !== 0 && contrast < 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#808080', opacity: Math.abs(contrast) * 0.4, pointerEvents: 'none' }]} />}
              {contrast > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: contrast * 0.12, pointerEvents: 'none' }]} />}
              {highlights !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: highlights > 0 ? '#FFFFFF' : '#000000', opacity: Math.abs(highlights) * 0.2, pointerEvents: 'none' }]} />}
              {shadows !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: shadows > 0 ? '#333333' : '#000000', opacity: Math.abs(shadows) * 0.3, pointerEvents: 'none' }]} />}
              {saturation < 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#808080', opacity: Math.abs(saturation) * 0.5, pointerEvents: 'none' }]} />}
              {saturation > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FF4500', opacity: saturation * 0.1, pointerEvents: 'none' }]} />}
              {vibrance > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#4169E1', opacity: vibrance * 0.08, pointerEvents: 'none' }]} />}
              {vibrance < 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#808080', opacity: Math.abs(vibrance) * 0.25, pointerEvents: 'none' }]} />}
              {temp !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: temp > 0 ? '#FF8C00' : '#0066FF', opacity: Math.abs(temp) * 0.2, pointerEvents: 'none' }]} />}
              {tint !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: tint > 0 ? '#FF00FF' : '#00FF00', opacity: Math.abs(tint) * 0.15, pointerEvents: 'none' }]} />}
              {fade > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#808080', opacity: fade * 0.35, pointerEvents: 'none' }]} />}
              {dehaze !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: dehaze > 0 ? '#000000' : '#C0C0C0', opacity: Math.abs(dehaze) * 0.2, pointerEvents: 'none' }]} />}
            </>
          )}

          {/* Filter overlay fallback (only when GL is not active) */}
          {glFailed && filterPreviewColor && filterPreviewColor !== 'transparent' && filterStrength > 0 && (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: filterPreviewColor, opacity: (!HAS_COLOR_MATRIX ? 0.35 : 0.08) * filterStrength, pointerEvents: 'none' }]} />
          )}

        </View>

      </View>
    );
});

const imageDimCache = new Map<string, number>();

// ── Grapheme-aware splitter: keeps Kannada/Indic clusters (base + matras + virama+consonant) together ──
const splitGraphemes = (input: string): string[] => {
  const s = input.replace(/\n/g, ' ');
  // Prefer Intl.Segmenter when available (handles all complex scripts)
  try {
    const Seg: any = (Intl as any)?.Segmenter;
    if (Seg) {
      const seg = new Seg(undefined, { granularity: 'grapheme' });
      const out: string[] = [];
      for (const it of seg.segment(s) as any) out.push(it.segment);
      return out;
    }
  } catch {}
  // Fallback: attach combining marks, virama+next, ZWJ/ZWNJ+next to preceding base
  const isCombining = (cp: number) => {
    // Kannada combining range + generic combining marks
    if (cp >= 0x0CBC && cp <= 0x0CCD) return true; // nukta, vowel signs, virama
    if (cp >= 0x0CD5 && cp <= 0x0CD6) return true; // length marks
    if (cp >= 0x0300 && cp <= 0x036F) return true; // generic combining
    if (cp === 0x200C || cp === 0x200D) return true; // ZWNJ/ZWJ
    return false;
  };
  const codepoints = Array.from(s);
  const clusters: string[] = [];
  for (let i = 0; i < codepoints.length; i++) {
    const cp = codepoints[i].codePointAt(0) || 0;
    if (clusters.length === 0 || !isCombining(cp)) {
      clusters.push(codepoints[i]);
    } else {
      clusters[clusters.length - 1] += codepoints[i];
      // If this is a virama (0x0CCD) or ZWJ, also consume next consonant as part of cluster
      if ((cp === 0x0CCD || cp === 0x200D) && i + 1 < codepoints.length) {
        const next = codepoints[i + 1];
        clusters[clusters.length - 1] += next;
        i++;
      }
    }
  }
  return clusters;
};

// ── Curved text renderer: lays out each grapheme cluster along an arc (C), wave (S), or circle (O) ──
const CurvedText: React.FC<{
  text: string;
  shape: 'arc' | 'wave' | 'circle';
  amount: number; // -100..100
  textStyle: TextStyle;
  strokeWidth?: number;
  strokeColor?: string;
}> = ({ text, shape, amount, textStyle, strokeWidth, strokeColor }) => {
  const chars = splitGraphemes(text);
  const n = chars.length;
  const fontSize = (textStyle.fontSize as number) || 40;
  const letterSpacing = (textStyle.letterSpacing as number) || 0;
  // Detect complex scripts (Kannada/Indic) and widen cluster advance so matras don't overlap
  const hasComplex = /[\u0900-\u0DFF]/.test(text);
  const baseAdvance = hasComplex ? fontSize * 0.88 : fontSize * 0.6;
  // Per-cluster width: longer clusters (consonant+matra, conjuncts) need a bit more room
  const clusterWidths = chars.map(c => {
    const len = Array.from(c).length;
    let w = baseAdvance + letterSpacing;
    if (hasComplex && len >= 2) w *= 1 + Math.min(0.3, (len - 1) * 0.1);
    return w;
  });
  // Clamp curve amount
  const a = Math.max(-100, Math.min(100, amount)) / 100;

  const totalLen = clusterWidths.reduce((s, w) => s + w, 0) || baseAdvance;
  // Cumulative center positions of each cluster along the baseline
  const centers: number[] = [];
  {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      centers.push(acc + clusterWidths[i] / 2);
      acc += clusterWidths[i];
    }
  }
  // Taller box for Indic ascenders/descenders/matras, biased upward so top matras don't clip
  const boxH = fontSize * (hasComplex ? 1.9 : 1.5);
  const glyphYOffset = hasComplex ? fontSize * 0.15 : 0;

  type P = { x: number; y: number; rot: number };
  const positions: P[] = [];

  if (n === 0) return null;

  if (shape === 'arc') {
    // Limit to ~170° to avoid glyph inversion at semicircle extremes
    const angleSpan = a * Math.PI * 0.94;
    if (Math.abs(angleSpan) < 0.002) {
      for (let i = 0; i < n; i++) positions.push({ x: centers[i], y: 0, rot: 0 });
    } else {
      const r = totalLen / Math.abs(angleSpan);
      for (let i = 0; i < n; i++) {
        const t = centers[i] / totalLen - 0.5;
        const theta = t * angleSpan;
        const x = totalLen / 2 + r * Math.sin(theta);
        const dy = r - r * Math.cos(theta);
        const y = angleSpan > 0 ? dy : -dy;
        positions.push({ x, y, rot: (theta * 180) / Math.PI });
      }
    }
  } else if (shape === 'wave') {
    const amp = a * fontSize * 0.6;
    const period = 2 * Math.PI;
    for (let i = 0; i < n; i++) {
      const t = centers[i] / totalLen;
      const phase = t * period;
      const y = amp * Math.sin(phase);
      // dy/dx = amp * (2π / totalLen) * cos(phase)
      const slope = (amp * period / totalLen) * Math.cos(phase);
      const rot = (Math.atan(slope) * 180) / Math.PI;
      positions.push({ x: centers[i], y, rot });
    }
  } else {
    // circle — always full 360° ring; amount controls radius tightness & direction
    const mag = Math.max(0.25, Math.abs(a)); // avoid infinite radius at 0
    const r = totalLen / (2 * Math.PI * mag);
    const sign = a >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      // Full ring — characters wrap around
      const theta = (centers[i] / totalLen) * 2 * Math.PI * mag * sign - Math.PI / 2;
      const x = r + r * Math.cos(theta);
      const y = r + r * Math.sin(theta);
      const rot = ((theta + Math.PI / 2) * 180) / Math.PI;
      positions.push({ x, y, rot });
    }
  }

  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const maxBoxW = Math.max(...clusterWidths) * 1.6;
  const padX = maxBoxW;
  const padY = boxH;
  const containerW = maxX - minX + padX;
  const containerH = maxY - minY + padY;
  const offX = -minX + padX / 2;
  const offY = -minY + padY / 2;

  const sw = strokeWidth || 0;
  const sc = strokeColor || '#000000';
  const strokeOffs: { x: number; y: number }[] = [];
  if (sw > 0) {
    const steps = Math.max(8, Math.round(sw * 4));
    for (let i = 0; i < steps; i++) {
      const ang = (2 * Math.PI * i) / steps;
      strokeOffs.push({ x: Math.cos(ang) * sw, y: Math.sin(ang) * sw });
    }
  }

  return (
    <View style={{ width: containerW, height: containerH }}>
      {chars.map((c, i) => {
        const p = positions[i];
        const boxW = Math.max(fontSize, clusterWidths[i] * 1.6);
        const left = p.x + offX - boxW / 2;
        // Bias box upward so top matras get more headroom (for Indic)
        const top = p.y + offY - boxH / 2 - glyphYOffset;
        return (
          <View key={i} style={{ position: 'absolute', left, top, width: boxW, height: boxH, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: `${p.rot}deg` }] }}>
            {strokeOffs.map((o, si) => (
              <Text key={`s${si}`} style={[textStyle, { position: 'absolute', color: sc, transform: [{ translateX: o.x }, { translateY: o.y }], textAlign: 'center' }]}>{c}</Text>
            ))}
            <Text style={[textStyle, { textAlign: 'center' }]}>{c}</Text>
          </View>
        );
      })}
    </View>
  );
};

const DraggableItem = React.memo(({ item, isSelected, canvasW, canvasH, fontList, onTap, onDoubleTap, onDragStart, onDragMove, onDragEnd, onWidthChangeStart, onWidthChange, onWidthChangeEnd }: any) => {
  const [, setRenderTick] = useState(0);
  const [size, setSize] = useState({ w: item.width || 0, h: 0 });
  const [stickerAspect, setStickerAspect] = useState(1);
  const transform = useRef({ x: item.x, y: item.y, scale: item.scale || 1, rotation: item.rotation || 0 }).current;
  const gestureState = useRef({ startX: 0, startY: 0, lastX: item.x, lastY: item.y, initialDistance: 0, initialAngle: 0, lastScale: 1, lastRotation: 0, pointers: 0, lastTapTime: 0, snappedX: false, snappedY: false, snappedRot: false, snapTypeX: '' as string, snapTypeY: '' as string }).current;
  const resizeRef = useRef({ startWidth: item.width || 200, startX: 0, startScale: 1, startRotation: 0 }).current;
  const latestProps = useRef({ onWidthChange, onWidthChangeStart, onWidthChangeEnd, onDragStart, onDragEnd, onTap, onDoubleTap, itemWidth: item.width });
  useEffect(() => { latestProps.current = { onWidthChange, onWidthChangeStart, onWidthChangeEnd, onDragStart, onDragEnd, onTap, onDoubleTap, itemWidth: item.width }; });

  const SNAP_THRESHOLD = 12;
  const SAFE_MARGIN = 0.08; // 8% safe area from edges

  const snapPosition = (rawX: number, rawY: number) => {
    let x = rawX, y = rawY;
    let sX = false, sY = false, snapTypeX = '', snapTypeY = '';
    const scaledW = size.w * transform.scale;
    const scaledH = size.h * transform.scale;
    const halfW = scaledW / 2, halfH = scaledH / 2;

    // Safe area boundaries (element edges)
    const safeL = -canvasW / 2 + canvasW * SAFE_MARGIN;
    const safeR = canvasW / 2 - canvasW * SAFE_MARGIN;
    const safeT = -canvasH / 2 + canvasH * SAFE_MARGIN;
    const safeB = canvasH / 2 - canvasH * SAFE_MARGIN;

    // Canvas edge boundaries
    const edgeL = -canvasW / 2;
    const edgeR = canvasW / 2;
    const edgeT = -canvasH / 2;
    const edgeB = canvasH / 2;

    // Vertical center snap (x=0)
    if (Math.abs(x) < SNAP_THRESHOLD) { x = 0; sX = true; snapTypeX = 'center'; }
    // Left safe area snap (element left edge)
    else if (Math.abs((x - halfW) - safeL) < SNAP_THRESHOLD) { x = safeL + halfW; sX = true; snapTypeX = 'safe'; }
    // Right safe area snap (element right edge)
    else if (Math.abs((x + halfW) - safeR) < SNAP_THRESHOLD) { x = safeR - halfW; sX = true; snapTypeX = 'safe'; }
    // Left canvas edge snap
    else if (Math.abs((x - halfW) - edgeL) < SNAP_THRESHOLD) { x = edgeL + halfW; sX = true; snapTypeX = 'edge'; }
    // Right canvas edge snap
    else if (Math.abs((x + halfW) - edgeR) < SNAP_THRESHOLD) { x = edgeR - halfW; sX = true; snapTypeX = 'edge'; }

    // Horizontal center snap (y=0)
    if (Math.abs(y) < SNAP_THRESHOLD) { y = 0; sY = true; snapTypeY = 'center'; }
    // Top safe area snap (element top edge)
    else if (Math.abs((y - halfH) - safeT) < SNAP_THRESHOLD) { y = safeT + halfH; sY = true; snapTypeY = 'safe'; }
    // Bottom safe area snap (element bottom edge)
    else if (Math.abs((y + halfH) - safeB) < SNAP_THRESHOLD) { y = safeB - halfH; sY = true; snapTypeY = 'safe'; }
    // Top canvas edge snap
    else if (Math.abs((y - halfH) - edgeT) < SNAP_THRESHOLD) { y = edgeT + halfH; sY = true; snapTypeY = 'edge'; }
    // Bottom canvas edge snap
    else if (Math.abs((y + halfH) - edgeB) < SNAP_THRESHOLD) { y = edgeB - halfH; sY = true; snapTypeY = 'edge'; }

    return { x, y, sX, sY, snapTypeX, snapTypeY };
  };

  useEffect(() => {
    transform.x = item.x; transform.y = item.y; transform.scale = item.scale ?? 1; transform.rotation = item.rotation ?? 0;
    setRenderTick(t => t + 1);
  }, [item.x, item.y, item.scale, item.rotation]);

  useEffect(() => {
    if (item.type === 'image' && item.src) {
      const cached = imageDimCache.get(item.src);
      if (cached) { setStickerAspect(cached); return; }
      Image.getSize(item.src, (w, h) => { if (w && h) { const aspect = w / h; imageDimCache.set(item.src, aspect); setStickerAspect(aspect); } });
    }
  }, [item.src]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const t = e.nativeEvent.touches; gestureState.pointers = t.length;
      if (t.length === 1) { gestureState.startX = t[0].pageX; gestureState.startY = t[0].pageY; gestureState.lastX = transform.x; gestureState.lastY = transform.y; onDragStart(item.id); }
    },
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (gestureState.pointers === 2 && t.length === 1) { gestureState.pointers = 1; gestureState.startX = t[0].pageX; gestureState.startY = t[0].pageY; gestureState.lastX = transform.x; gestureState.lastY = transform.y; return; }
      if (gestureState.pointers === 1 && t.length === 2) { gestureState.pointers = 2; gestureState.initialDistance = Math.max(1, Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY)); gestureState.initialAngle = Math.atan2(t[0].pageY - t[1].pageY, t[0].pageX - t[1].pageX) * (180 / Math.PI); gestureState.lastScale = transform.scale; gestureState.lastRotation = transform.rotation; return; }
      gestureState.pointers = t.length;
      
      if (t.length === 1) {
        let rawX = gestureState.lastX + (t[0].pageX - gestureState.startX); let rawY = gestureState.lastY + (t[0].pageY - gestureState.startY);
        const snap = snapPosition(rawX, rawY);
        transform.x = snap.x; transform.y = snap.y; gestureState.snappedX = snap.sX; gestureState.snappedY = snap.sY; gestureState.snapTypeX = snap.snapTypeX; gestureState.snapTypeY = snap.snapTypeY;
        onDragMove(e.nativeEvent.pageY); setRenderTick(t => t + 1);
      } else if (t.length === 2) {
        const dx = t[0].pageX - t[1].pageX; const dy = t[0].pageY - t[1].pageY;
        const newScale = gestureState.lastScale * (Math.max(1, Math.hypot(dx, dy)) / gestureState.initialDistance);
        if (!isNaN(newScale)) transform.scale = Math.max(0.3, Math.min(newScale, 15)); 
        let newRot = gestureState.lastRotation + ((Math.atan2(dy, dx) * (180 / Math.PI)) - gestureState.initialAngle);
        let sRot = false; let bestAngle = newRot;
        for (const snap of [0, 45, 90, 135, 180, 225, 270, 315, 360, -45, -90, -135, -180, -225, -270, -315, -360]) { if (Math.abs(newRot - snap) < 8) { bestAngle = snap; sRot = true; break; } }
        if (!isNaN(newRot)) transform.rotation = bestAngle; gestureState.snappedRot = sRot; setRenderTick(t => t + 1);
      }
    },
    onPanResponderRelease: (e, gesture) => {
      gestureState.pointers = 0; gestureState.lastX = transform.x; gestureState.lastY = transform.y; gestureState.lastScale = transform.scale; gestureState.lastRotation = transform.rotation;
      gestureState.snappedX = false; gestureState.snappedY = false; gestureState.snappedRot = false; gestureState.snapTypeX = ''; gestureState.snapTypeY = ''; setRenderTick(t => t + 1);
      if (Math.abs(gesture.dx) < 5 && Math.abs(gesture.dy) < 5) { const now = Date.now(); if (now - gestureState.lastTapTime < 300 && item.type === 'text') latestProps.current.onDoubleTap(item.id); else latestProps.current.onTap(item.id, item.type); gestureState.lastTapTime = now; }
      onDragEnd(item.id, gesture.moveY, transform.x, transform.y, transform.scale, transform.rotation);
    }
  })).current;

  const createScaleResponder = (factorX: number, factorY: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: () => { resizeRef.startScale = transform.scale; resizeRef.startRotation = transform.rotation; onDragStart(item.id); },
    onPanResponderMove: (e, gesture) => {
      const startRad = resizeRef.startRotation * (Math.PI / 180);
      const localDx = gesture.dx * Math.cos(-startRad) - gesture.dy * Math.sin(-startRad);
      const localDy = gesture.dx * Math.sin(-startRad) + gesture.dy * Math.cos(-startRad);
      const delta = (localDx * factorX + localDy * factorY) * 0.005;
      transform.scale = Math.max(0.1, resizeRef.startScale + delta);
      setRenderTick(t => t + 1);
    },
    onPanResponderRelease: () => onDragEnd(item.id, 0, transform.x, transform.y, transform.scale, transform.rotation)
  });

  const tlResponder = useRef(createScaleResponder(-1, -1)).current;
  const trResponder = useRef(createScaleResponder(1, -1)).current;
  const blResponder = useRef(createScaleResponder(-1, 1)).current;
  const brResponder = useRef(createScaleResponder(1, 1)).current;

  const createWidthResponder = (factorX: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: () => { resizeRef.startWidth = latestProps.current.itemWidth || size.w || 250; resizeRef.startRotation = transform.rotation; latestProps.current.onWidthChangeStart(); latestProps.current.onDragStart(item.id); },
    onPanResponderMove: (e, gesture) => {
      const startRad = resizeRef.startRotation * (Math.PI / 180);
      const localDx = gesture.dx * Math.cos(-startRad) - gesture.dy * Math.sin(-startRad);
      const newWidth = Math.max(50, resizeRef.startWidth + (localDx * factorX * (1 / transform.scale)));
      latestProps.current.onWidthChange(item.id, newWidth); setSize(prev => ({ ...prev, w: newWidth }));
    },
    onPanResponderRelease: () => { latestProps.current.onWidthChangeEnd(); latestProps.current.onDragEnd(item.id, 0, transform.x, transform.y, transform.scale, transform.rotation); }
  });

  const leftWidthResponder = useRef(createWidthResponder(-1)).current;
  const rightWidthResponder = useRef(createWidthResponder(1)).current;

  const rotateResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: () => { resizeRef.startRotation = transform.rotation; onDragStart(item.id); },
    onPanResponderMove: (e, gesture) => {
      const startRad = resizeRef.startRotation * (Math.PI / 180);
      let deltaAngle = (gesture.dy * Math.cos(startRad)) - (gesture.dx * Math.sin(startRad));
      let rawAngle = resizeRef.startRotation + (deltaAngle * 1.2); 
      let sRot = false; let finalAngle = rawAngle;
      for (const snap of [0, 45, 90, 135, 180, 225, 270, 315, 360, -45, -90, -135, -180, -225, -270, -315, -360]) { if (Math.abs(rawAngle - snap) < 8) { finalAngle = snap; sRot = true; break; } }
      transform.rotation = finalAngle; gestureState.snappedRot = sRot; setRenderTick(t => t + 1);
    },
    onPanResponderRelease: () => { gestureState.snappedRot = false; setRenderTick(t => t + 1); onDragEnd(item.id, 0, transform.x, transform.y, transform.scale, transform.rotation); }
  })).current;

  const actualFont = item.isBold ? fontList.find((f:any) => f.value === item.fontFamily)?.boldValue || item.fontFamily : item.fontFamily;
  const shadowAngleRad = (item.shadowAngle || 45) * (Math.PI / 180);
  const shadowDist = item.shadowDistance || 0;

  const baseTextStyle: TextStyle = {
    color: item.color?.startsWith('gradient:') ? '#FFFFFF' : item.color, fontFamily: actualFont, fontSize: item.fontSize, letterSpacing: item.letterSpacing,
    textAlign: item.textAlign || 'center', lineHeight: item.lineHeight || (item.fontSize ? item.fontSize * 1.4 : 65),
    fontStyle: item.isItalic ? 'italic' : 'normal', textDecorationLine: item.isUnderline ? 'underline' : 'none',
    includeFontPadding: false, 
    textShadowColor: item.shadowOpacity && item.shadowOpacity > 0 ? hexToRgba(item.shadowColor || '#000000', item.shadowOpacity) : 'transparent',
    textShadowOffset: { width: shadowDist * Math.cos(shadowAngleRad), height: shadowDist * Math.sin(shadowAngleRad) },
    textShadowRadius: item.shadowBlur || 0
  };

  // Base style without shadow — used for layered rendering (shadow is a separate layer behind stroke)
  const baseNoShadowStyle: TextStyle = {
    color: item.color?.startsWith('gradient:') ? '#FFFFFF' : item.color, fontFamily: actualFont, fontSize: item.fontSize, letterSpacing: item.letterSpacing,
    textAlign: item.textAlign || 'center', lineHeight: item.lineHeight || (item.fontSize ? item.fontSize * 1.4 : 65),
    fontStyle: item.isItalic ? 'italic' : 'normal', textDecorationLine: item.isUnderline ? 'underline' : 'none',
    includeFontPadding: false,
  };
  const hasShadowText = (item.shadowOpacity || 0) > 0;

  // Stroke: generate circular offset positions for text outline
  const strokeW = item.strokeWidth || 0;
  const strokeC = item.strokeColor || '#000000';
  const strokeOffsets = useMemo(() => {
    if (strokeW <= 0) return [];
    const offsets: { x: number; y: number }[] = [];
    const steps = Math.max(12, Math.round(strokeW * 4));
    for (let i = 0; i < steps; i++) {
      const angle = (2 * Math.PI * i) / steps;
      offsets.push({ x: Math.cos(angle) * strokeW, y: Math.sin(angle) * strokeW });
    }
    return offsets;
  }, [strokeW]);

  // Glow: blurred shadow with 0 distance
  const glowR = item.glowRadius || 0;
  const glowO = item.glowOpacity || 0;
  const glowC = item.glowColor || '#FFFFFF';

  const isGradientText = item.type === 'text' && item.color?.startsWith('gradient:');
  const gradientTextColors = isGradientText ? item.color!.replace('gradient:', '').split(',') : [];
  const isGradientSticker = item.type === 'image' && item.isTintable && item.color?.startsWith('gradient:');
  const gradientStickerColors = isGradientSticker ? item.color!.replace('gradient:', '').split(',') : [];
  const gAngle = ((item.gradientAngle ?? 45) * Math.PI) / 180;
  const gradientStart = { x: 0.5 - 0.5 * Math.cos(gAngle), y: 0.5 - 0.5 * Math.sin(gAngle) };
  const gradientEnd = { x: 0.5 + 0.5 * Math.cos(gAngle), y: 0.5 + 0.5 * Math.sin(gAngle) };

  return (
    <View style={[styles.draggable, { left: canvasW / 2, top: canvasH / 2, opacity: item.opacity ?? 1, transform: [{ translateX: transform.x - size.w / 2 }, { translateY: transform.y - size.h / 2 }] }, item.blendMode && item.blendMode !== 'normal' ? ({ mixBlendMode: item.blendMode } as any) : null]} {...panResponder.panHandlers}>
      {/* Center snap guide - gold */}
      {gestureState.snappedX && gestureState.snapTypeX === 'center' && <View style={{ position: 'absolute', left: '50%', top: -2000, height: 4000, width: 1, backgroundColor: THEME.guideLine, zIndex: -10, opacity: 0.8 }} />}
      {gestureState.snappedY && gestureState.snapTypeY === 'center' && <View style={{ position: 'absolute', top: '50%', left: -2000, width: 4000, height: 1, backgroundColor: THEME.guideLine, zIndex: -10, opacity: 0.8 }} />}
      {/* Safe area snap guide - cyan */}
      {gestureState.snappedX && gestureState.snapTypeX === 'safe' && <View style={{ position: 'absolute', left: transform.x < 0 ? 0 : undefined, right: transform.x >= 0 ? 0 : undefined, top: -2000, height: 4000, width: 1, backgroundColor: '#4FC3F7', zIndex: -10, opacity: 0.7 }} />}
      {gestureState.snappedY && gestureState.snapTypeY === 'safe' && <View style={{ position: 'absolute', top: transform.y < 0 ? 0 : undefined, bottom: transform.y >= 0 ? 0 : undefined, left: -2000, width: 4000, height: 1, backgroundColor: '#4FC3F7', zIndex: -10, opacity: 0.7 }} />}
      {/* Edge snap guide - white */}
      {gestureState.snappedX && gestureState.snapTypeX === 'edge' && <View style={{ position: 'absolute', left: transform.x < 0 ? 0 : undefined, right: transform.x >= 0 ? 0 : undefined, top: -2000, height: 4000, width: 1.5, backgroundColor: '#FFFFFF', zIndex: -10, opacity: 0.5 }} />}
      {gestureState.snappedY && gestureState.snapTypeY === 'edge' && <View style={{ position: 'absolute', top: transform.y < 0 ? 0 : undefined, bottom: transform.y >= 0 ? 0 : undefined, left: -2000, width: 4000, height: 1.5, backgroundColor: '#FFFFFF', zIndex: -10, opacity: 0.5 }} />}
      
      <View onLayout={(e) => { const layoutW = e.nativeEvent.layout.width; const layoutH = e.nativeEvent.layout.height; setSize({ w: layoutW, h: layoutH }); }} style={{ transform: [{ scale: transform.scale }, { rotate: `${transform.rotation}deg` }, { perspective: 800 }, { rotateX: `${item.rotateX || 0}deg` }, { rotateY: `${item.rotateY || 0}deg` }, { rotateZ: `${item.rotateZ || 0}deg` }] }}>
        {gestureState.snappedRot && ( <View style={{ position: 'absolute', top: '50%', left: -1000, width: 2000, height: 1, backgroundColor: THEME.guideLine, opacity: 0.6, zIndex: -5 }} /> )}
        <View style={{ width: item.type === 'image' ? item.width : (item.type === 'text' && item.width ? item.width : undefined), padding: item.type === 'text' ? 4 : 0, borderWidth: isSelected ? 2 : 0, borderColor: isSelected ? THEME.boundingBox : 'transparent', borderStyle: 'solid', overflow: 'visible' }}>
          
          {item.type === 'image' && item.src ? ( 
            <View>
              {/* Sticker glow layer (behind everything) */}
              {item.isTintable && glowO > 0 && (
                <Image 
                  source={{ uri: item.src }} 
                  style={{ 
                    width: stickerAspect >= 1 ? 100 : 100 * stickerAspect, 
                    height: stickerAspect >= 1 ? 100 / stickerAspect : 100,
                    position: 'absolute',
                    tintColor: glowC,
                    opacity: glowO,
                  }} 
                  resizeMode="contain"
                  blurRadius={Math.round(glowR * 1.5)}
                />
              )}
              {/* Sticker shadow layer (behind stroke) */}
              {item.isTintable && (item.shadowOpacity ?? 0) > 0 && (
                <Image 
                  source={{ uri: item.src }} 
                  style={[{ 
                    width: stickerAspect >= 1 ? 100 : 100 * stickerAspect, 
                    height: stickerAspect >= 1 ? 100 / stickerAspect : 100,
                    position: 'absolute',
                    tintColor: item.shadowColor || '#000000',
                    opacity: item.shadowOpacity,
                    left: (item.shadowDistance || 0) * Math.cos(((item.shadowAngle || 135) * Math.PI) / 180),
                    top: (item.shadowDistance || 0) * Math.sin(((item.shadowAngle || 135) * Math.PI) / 180),
                  }]} 
                  resizeMode="contain"
                  blurRadius={item.shadowBlur || 0}
                />
              )}
              {/* Sticker stroke layers (behind main) */}
              {item.isTintable && strokeW > 0 && strokeOffsets.map((off, si) => (
                <Image 
                  key={`stroke_${si}`}
                  source={{ uri: item.src }} 
                  style={{ 
                    width: stickerAspect >= 1 ? 100 : 100 * stickerAspect, 
                    height: stickerAspect >= 1 ? 100 / stickerAspect : 100,
                    position: 'absolute',
                    tintColor: strokeC,
                    left: off.x,
                    top: off.y,
                  }} 
                  resizeMode="contain"
                />
              ))}
              <Image 
                source={{ uri: item.src }} 
                style={[{ width: stickerAspect >= 1 ? 100 : 100 * stickerAspect, height: stickerAspect >= 1 ? 100 / stickerAspect : 100 }, item.isTintable && item.color && !isGradientSticker ? { tintColor: item.color } : null]} 
                resizeMode="contain" 
              />
              {isGradientSticker && (
                <MaskedView
                  style={{ position: 'absolute', width: stickerAspect >= 1 ? 100 : 100 * stickerAspect, height: stickerAspect >= 1 ? 100 / stickerAspect : 100 }}
                  maskElement={<Image source={{ uri: item.src }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />}
                >
                  <LinearGradient colors={gradientStickerColors} start={gradientStart} end={gradientEnd} style={{ flex: 1 }} />
                </MaskedView>
              )}
            </View>
          ) : item.templateLines && item.templateLines.length > 0 ? (
            <View style={{ alignItems: 'center', width: item.width || 280 }}>
              {item.templateLines.map((line: any, li: number) => {
                const tlLineHeight = Math.round(line.fontSize * 1.4);
                const tlBoldFont = fontList.find((f: any) => f.value === line.fontFamily)?.boldValue;
                const tlFont = line.isBold && tlBoldFont ? tlBoldFont : line.fontFamily;
                const tlBaseStyle: TextStyle = {
                    fontFamily: tlFont,
                    fontSize: line.fontSize,
                    color: line.color,
                    fontWeight: line.isBold ? 'bold' : 'normal',
                    letterSpacing: line.letterSpacing || 0,
                    textAlign: item.textAlign || 'center',
                    lineHeight: tlLineHeight,
                    includeFontPadding: false,
                    width: '100%',
                };
                const hasShadow = (item.shadowOpacity || 0) > 0;
                return (
                  <View key={li} style={{ width: '100%' }}>
                    {glowO > 0 && <Text style={[tlBaseStyle, { position: 'absolute', color: 'transparent', textShadowColor: hexToRgba(glowC, glowO), textShadowOffset: { width: 0, height: 0 }, textShadowRadius: glowR }]}>{line.text}</Text>}
                    {glowO > 0 && <Text style={[tlBaseStyle, { position: 'absolute', color: 'transparent', textShadowColor: hexToRgba(glowC, glowO * 0.6), textShadowOffset: { width: 0, height: 0 }, textShadowRadius: glowR * 2 }]}>{line.text}</Text>}
                    {hasShadow && <Text style={[tlBaseStyle, { position: 'absolute', color: 'transparent', textShadowColor: hexToRgba(item.shadowColor || '#000000', item.shadowOpacity!), textShadowOffset: { width: shadowDist * Math.cos(shadowAngleRad), height: shadowDist * Math.sin(shadowAngleRad) }, textShadowRadius: item.shadowBlur || 0 }]}>{line.text}</Text>}
                    {strokeOffsets.map((off, si) => <Text key={si} style={[tlBaseStyle, { position: 'absolute', color: strokeC }, { transform: [{ translateX: off.x }, { translateY: off.y }] }]}>{line.text}</Text>)}
                    <Text style={tlBaseStyle}>{line.text}</Text>
                  </View>
                );
              })}
            </View>
          ) : isGradientText ? (
            <View style={{ alignSelf: 'flex-start' }}>
              {glowO > 0 && <Text style={[baseNoShadowStyle, { position: 'absolute', alignSelf: 'flex-start', color: 'transparent', textShadowColor: hexToRgba(glowC, glowO), textShadowOffset: { width: 0, height: 0 }, textShadowRadius: glowR }]}>{item.content}</Text>}
              {glowO > 0 && <Text style={[baseNoShadowStyle, { position: 'absolute', alignSelf: 'flex-start', color: 'transparent', textShadowColor: hexToRgba(glowC, glowO * 0.6), textShadowOffset: { width: 0, height: 0 }, textShadowRadius: glowR * 2 }]}>{item.content}</Text>}
              {hasShadowText && <Text style={[baseNoShadowStyle, { position: 'absolute', alignSelf: 'flex-start', color: 'transparent', textShadowColor: hexToRgba(item.shadowColor || '#000000', item.shadowOpacity!), textShadowOffset: { width: shadowDist * Math.cos(shadowAngleRad), height: shadowDist * Math.sin(shadowAngleRad) }, textShadowRadius: item.shadowBlur || 0 }]}>{item.content}</Text>}
              {strokeOffsets.map((off, si) => <Text key={si} style={[baseNoShadowStyle, { position: 'absolute', alignSelf: 'flex-start', color: strokeC }, { transform: [{ translateX: off.x }, { translateY: off.y }] }]}>{item.content}</Text>)}
              <MaskedView
                style={{ alignSelf: 'flex-start' }}
                maskElement={<Text style={[baseNoShadowStyle, { alignSelf: 'flex-start', opacity: 1 }]}>{item.content}</Text>}
              >
                <LinearGradient colors={gradientTextColors} start={gradientStart} end={gradientEnd}>
                  <Text style={[baseNoShadowStyle, { alignSelf: 'flex-start', opacity: 0 }]}>{item.content}</Text>
                </LinearGradient>
              </MaskedView>
            </View>
          ) : (
            <View style={{ alignSelf: 'flex-start' }}>
              {item.type === 'text' && item.textShape && item.textShape !== 'none' && Math.abs(item.textCurveAmount || 0) > 0.5 ? (
                <CurvedText
                  text={item.content || ''}
                  shape={item.textShape}
                  amount={item.textCurveAmount || 0}
                  textStyle={baseNoShadowStyle}
                  strokeWidth={strokeW}
                  strokeColor={strokeC}
                />
              ) : (
                <>
              {glowO > 0 && <Text style={[baseNoShadowStyle, { position: 'absolute', alignSelf: 'flex-start', color: 'transparent', textShadowColor: hexToRgba(glowC, glowO), textShadowOffset: { width: 0, height: 0 }, textShadowRadius: glowR }]}>{item.content}</Text>}
              {glowO > 0 && <Text style={[baseNoShadowStyle, { position: 'absolute', alignSelf: 'flex-start', color: 'transparent', textShadowColor: hexToRgba(glowC, glowO * 0.6), textShadowOffset: { width: 0, height: 0 }, textShadowRadius: glowR * 2 }]}>{item.content}</Text>}
              {hasShadowText && <Text style={[baseNoShadowStyle, { position: 'absolute', alignSelf: 'flex-start', color: 'transparent', textShadowColor: hexToRgba(item.shadowColor || '#000000', item.shadowOpacity!), textShadowOffset: { width: shadowDist * Math.cos(shadowAngleRad), height: shadowDist * Math.sin(shadowAngleRad) }, textShadowRadius: item.shadowBlur || 0 }]}>{item.content}</Text>}
              {strokeOffsets.map((off, si) => <Text key={si} style={[baseNoShadowStyle, { position: 'absolute', alignSelf: 'flex-start', color: strokeC }, { transform: [{ translateX: off.x }, { translateY: off.y }] }]}>{item.content}</Text>)}
              <Text style={[baseNoShadowStyle, { alignSelf: 'flex-start' }]}>{item.content}</Text>
                </>
              )}
            </View>
          )}
          
          {isSelected && (
            <>
              {/* Corner handles - scale */}
              <View style={[styles.resizeHandleSquare, { top: -6, left: -6 }]} {...tlResponder.panHandlers} />
              <View style={[styles.resizeHandleSquare, { top: -6, right: -6 }]} {...trResponder.panHandlers} />
              <View style={[styles.resizeHandleSquare, { bottom: -6, left: -6 }]} {...blResponder.panHandlers} />
              <View style={[styles.resizeHandleSquare, { bottom: -6, right: -6 }]} {...brResponder.panHandlers} />
              {/* Side handles - adjust text width */}
              {item.type === 'text' && (
                <>
                  <View style={{ position: 'absolute', top: '50%', marginTop: -25, left: -18, width: 30, height: 50, zIndex: 200, justifyContent: 'center', alignItems: 'center' }} {...leftWidthResponder.panHandlers}><View style={{ width: 10, height: 40, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: THEME.boundingBox, borderRadius: 5 }} pointerEvents="none" /></View>
                  <View style={{ position: 'absolute', top: '50%', marginTop: -25, right: -18, width: 30, height: 50, zIndex: 200, justifyContent: 'center', alignItems: 'center' }} {...rightWidthResponder.panHandlers}><View style={{ width: 10, height: 40, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: THEME.boundingBox, borderRadius: 5 }} pointerEvents="none" /></View>
                </>
              )}
              {/* Top/bottom midpoints (decorative) */}
              <View style={[styles.resizeHandleSquare, { top: -6, left: '50%', marginLeft: -5 }]} />
              <View style={[styles.resizeHandleSquare, { bottom: -6, left: '50%', marginLeft: -5 }]} />
              {/* Rotate handle */}
              <View style={{ position: 'absolute', right: -25, top: '50%', marginTop: -1, width: 20, height: 2, backgroundColor: THEME.boundingBox, zIndex: 199 }} />
              <View style={[styles.rotateHandleCircle, { right: -35, top: '50%', marginTop: -10, backgroundColor: gestureState.snappedRot ? THEME.guideLine : '#FFFFFF' }]} {...rotateResponder.panHandlers}>
                <MaterialIcons name="redo" size={10} color={gestureState.snappedRot ? '#FFFFFF' : THEME.boundingBox} style={{ margin: 3.5 }} />
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
});

// Group bounding box that wraps multiple grouped elements into a single draggable unit
const GroupBoundingBox = React.memo(({ groupId, elements, canvasW, canvasH, isSelected, isEditMode, onTap, onDoubleTap, onDragStart, onDragMove, onDragEnd }: {
  groupId: string; elements: CanvasElement[]; canvasW: number; canvasH: number; isSelected: boolean; isEditMode?: boolean;
  onTap: () => void; onDoubleTap: () => void; onDragStart: () => void; onDragMove: (dx: number, dy: number, ds: number, dr: number) => void; onDragEnd: (dx: number, dy: number, ds: number, dr: number) => void;
}) => {
  const groupEls = elements.filter(e => e.groupId === groupId);

  // Compute bounding box around all elements (accounting for scale, lineHeight)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  groupEls.forEach(e => {
    const s = e.scale || 1;
    const w = (e.width || 200) * s;
    // Use lineHeight for more accurate height, with fallback to fontSize * 1.6
    const rawH = e.type === 'image' ? (e.width || 100) : (e.lineHeight || (e.fontSize ? e.fontSize * 1.6 : 60));
    const h = rawH * s;
    minX = Math.min(minX, e.x - w / 2);
    maxX = Math.max(maxX, e.x + w / 2);
    minY = Math.min(minY, e.y - h / 2);
    maxY = Math.max(maxY, e.y + h / 2);
  });
  const PAD = 16;
  const hasEls = groupEls.length > 0;
  const boxW = hasEls ? maxX - minX + PAD * 2 : 0;
  const boxH = hasEls ? maxY - minY + PAD * 2 : 0;
  const boxCx = hasEls ? (minX + maxX) / 2 : 0;
  const boxCy = hasEls ? (minY + maxY) / 2 : 0;

  const SNAP_THRESHOLD = 12;
  const SAFE_MARGIN = 0.08;

  const transform = useRef({ x: 0, y: 0, scale: 1, rotation: 0 }).current;
  const gestureState = useRef({ startX: 0, startY: 0, lastX: 0, lastY: 0, initialDistance: 0, initialAngle: 0, lastScale: 1, lastRotation: 0, pointers: 0, lastTapTime: 0, snappedX: false, snappedY: false, snappedRot: false, snapTypeX: '' as string, snapTypeY: '' as string }).current;
  const boxRef = useRef({ cx: boxCx, cy: boxCy, w: boxW, h: boxH });
  boxRef.current = { cx: boxCx, cy: boxCy, w: boxW, h: boxH };

  useEffect(() => {
    transform.x = boxCx; transform.y = boxCy; transform.scale = 1; transform.rotation = 0;
    gestureState.lastX = boxCx; gestureState.lastY = boxCy; gestureState.lastScale = 1; gestureState.lastRotation = 0;
  }, [boxCx, boxCy]);

  const [, setRenderTick] = useState(0);

  const onTapRef = useRef(onTap); onTapRef.current = onTap;
  const onDoubleTapRef = useRef(onDoubleTap); onDoubleTapRef.current = onDoubleTap;
  const onDragStartRef = useRef(onDragStart); onDragStartRef.current = onDragStart;
  const onDragMoveRef = useRef(onDragMove); onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd); onDragEndRef.current = onDragEnd;

  const snapGroupPosition = (rawX: number, rawY: number) => {
    let x = rawX, y = rawY;
    let sX = false, sY = false, stX = '', stY = '';
    const bw = boxRef.current.w * transform.scale;
    const bh = boxRef.current.h * transform.scale;
    const halfW = bw / 2, halfH = bh / 2;
    const safeL = -canvasW / 2 + canvasW * SAFE_MARGIN;
    const safeR = canvasW / 2 - canvasW * SAFE_MARGIN;
    const safeT = -canvasH / 2 + canvasH * SAFE_MARGIN;
    const safeB = canvasH / 2 - canvasH * SAFE_MARGIN;
    // Center snap
    if (Math.abs(x) < SNAP_THRESHOLD) { x = 0; sX = true; stX = 'center'; }
    else if (Math.abs((x - halfW) - safeL) < SNAP_THRESHOLD) { x = safeL + halfW; sX = true; stX = 'safe'; }
    else if (Math.abs((x + halfW) - safeR) < SNAP_THRESHOLD) { x = safeR - halfW; sX = true; stX = 'safe'; }
    if (Math.abs(y) < SNAP_THRESHOLD) { y = 0; sY = true; stY = 'center'; }
    else if (Math.abs((y - halfH) - safeT) < SNAP_THRESHOLD) { y = safeT + halfH; sY = true; stY = 'safe'; }
    else if (Math.abs((y + halfH) - safeB) < SNAP_THRESHOLD) { y = safeB - halfH; sY = true; stY = 'safe'; }
    return { x, y, sX, sY, stX, stY };
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const t = e.nativeEvent.touches; gestureState.pointers = t.length;
      if (t.length === 1) { gestureState.startX = t[0].pageX; gestureState.startY = t[0].pageY; gestureState.lastX = transform.x; gestureState.lastY = transform.y; onDragStartRef.current(); }
      if (t.length === 2) {
        gestureState.pointers = 2;
        gestureState.initialDistance = Math.max(1, Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY));
        gestureState.initialAngle = Math.atan2(t[0].pageY - t[1].pageY, t[0].pageX - t[1].pageX) * (180 / Math.PI);
        gestureState.lastScale = transform.scale; gestureState.lastRotation = transform.rotation;
      }
    },
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (gestureState.pointers === 2 && t.length === 1) { gestureState.pointers = 1; gestureState.startX = t[0].pageX; gestureState.startY = t[0].pageY; gestureState.lastX = transform.x; gestureState.lastY = transform.y; return; }
      if (gestureState.pointers === 1 && t.length === 2) { gestureState.pointers = 2; gestureState.initialDistance = Math.max(1, Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY)); gestureState.initialAngle = Math.atan2(t[0].pageY - t[1].pageY, t[0].pageX - t[1].pageX) * (180 / Math.PI); gestureState.lastScale = transform.scale; gestureState.lastRotation = transform.rotation; return; }
      gestureState.pointers = t.length;
      if (t.length === 1) {
        const rawX = gestureState.lastX + (t[0].pageX - gestureState.startX);
        const rawY = gestureState.lastY + (t[0].pageY - gestureState.startY);
        const snap = snapGroupPosition(rawX, rawY);
        transform.x = snap.x; transform.y = snap.y;
        gestureState.snappedX = snap.sX; gestureState.snappedY = snap.sY;
        gestureState.snapTypeX = snap.stX; gestureState.snapTypeY = snap.stY;
        onDragMoveRef.current(transform.x - boxRef.current.cx, transform.y - boxRef.current.cy, transform.scale, transform.rotation);
        setRenderTick(n => n + 1);
      } else if (t.length === 2) {
        const dx = t[0].pageX - t[1].pageX; const dy = t[0].pageY - t[1].pageY;
        const newScale = gestureState.lastScale * (Math.max(1, Math.hypot(dx, dy)) / gestureState.initialDistance);
        if (!isNaN(newScale)) transform.scale = Math.max(0.3, Math.min(newScale, 15));
        let newRot = gestureState.lastRotation + ((Math.atan2(dy, dx) * (180 / Math.PI)) - gestureState.initialAngle);
        let sRot = false; let bestAngle = newRot;
        for (const snap of [0, 45, 90, 135, 180, -45, -90, -135, -180]) { if (Math.abs(newRot - snap) < 8) { bestAngle = snap; sRot = true; break; } }
        if (!isNaN(newRot)) transform.rotation = bestAngle;
        gestureState.snappedRot = sRot;
        onDragMoveRef.current(transform.x - boxRef.current.cx, transform.y - boxRef.current.cy, transform.scale, transform.rotation);
        setRenderTick(n => n + 1);
      }
    },
    onPanResponderRelease: (e, gesture) => {
      gestureState.pointers = 0;
      gestureState.snappedX = false; gestureState.snappedY = false; gestureState.snappedRot = false;
      gestureState.snapTypeX = ''; gestureState.snapTypeY = '';
      const { cx, cy } = boxRef.current;
      if (Math.abs(gesture.dx) < 5 && Math.abs(gesture.dy) < 5) {
        const now = Date.now();
        if (now - gestureState.lastTapTime < 350) {
          onDoubleTapRef.current();
        } else {
          onTapRef.current();
        }
        gestureState.lastTapTime = now;
      } else {
        onDragEndRef.current(transform.x - cx, transform.y - cy, transform.scale, transform.rotation);
      }
      // Reset live drag transform so parent clears the visual offset
      onDragMoveRef.current(0, 0, 1, 0);
      transform.x = cx; transform.y = cy; transform.scale = 1; transform.rotation = 0;
      gestureState.lastX = cx; gestureState.lastY = cy; gestureState.lastScale = 1; gestureState.lastRotation = 0;
      setRenderTick(n => n + 1);
    }
  })).current;

  if (!hasEls) return null;

  const HANDLE_SIZE = 12;
  const HANDLE_HIT = 24; // larger touch target

  // Edit mode — dashed outline with "Editing" label, passive (pointer-events: none)
  if (isEditMode) {
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 699 }]} pointerEvents="none">
        <View style={{ position: 'absolute', left: canvasW / 2 + boxCx - boxW / 2, top: canvasH / 2 + boxCy - boxH / 2, width: boxW, height: boxH }}>
          {/* Subtle background tint */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(221,198,22,0.04)', borderRadius: 10 }} />
          {/* Dashed border */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1.5, borderColor: 'rgba(221,198,22,0.35)', borderStyle: 'dashed', borderRadius: 10 }} />
          {/* "Editing" label */}
          <View style={{ position: 'absolute', top: -22, alignSelf: 'center', left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ backgroundColor: THEME.primary, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 6 }}>
              <Text style={{ color: THEME.bgBase, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>EDITING GROUP</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // Selected mode — solid border, corner handles, snap guides, "double-tap to edit" hint
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 700 }]} pointerEvents="box-none">
      {/* Snap guides */}
      {gestureState.snappedX && gestureState.snapTypeX === 'center' && <View style={{ position: 'absolute', left: canvasW / 2, top: 0, bottom: 0, width: 1, backgroundColor: THEME.guideLine, opacity: 0.8, zIndex: 710 }} pointerEvents="none" />}
      {gestureState.snappedY && gestureState.snapTypeY === 'center' && <View style={{ position: 'absolute', top: canvasH / 2, left: 0, right: 0, height: 1, backgroundColor: THEME.guideLine, opacity: 0.8, zIndex: 710 }} pointerEvents="none" />}
      {gestureState.snappedX && gestureState.snapTypeX === 'safe' && <View style={{ position: 'absolute', left: transform.x < 0 ? canvasW * SAFE_MARGIN : canvasW * (1 - SAFE_MARGIN), top: 0, bottom: 0, width: 1, backgroundColor: '#4FC3F7', opacity: 0.7, zIndex: 710 }} pointerEvents="none" />}
      {gestureState.snappedY && gestureState.snapTypeY === 'safe' && <View style={{ position: 'absolute', top: transform.y < 0 ? canvasH * SAFE_MARGIN : canvasH * (1 - SAFE_MARGIN), left: 0, right: 0, height: 1, backgroundColor: '#4FC3F7', opacity: 0.7, zIndex: 710 }} pointerEvents="none" />}
      {gestureState.snappedRot && <View style={{ position: 'absolute', top: canvasH / 2, left: 0, right: 0, height: 1, backgroundColor: THEME.guideLine, opacity: 0.5, zIndex: 710 }} pointerEvents="none" />}

      <View style={{ position: 'absolute', left: canvasW / 2 + transform.x - boxW / 2, top: canvasH / 2 + transform.y - boxH / 2, width: boxW, height: boxH, transform: [{ scale: transform.scale }, { rotate: `${transform.rotation}deg` }] }} {...panResponder.panHandlers}>
        {/* Border glow */}
        {isSelected && <View style={{ position: 'absolute', top: -2, left: -2, right: -2, bottom: -2, borderWidth: 1, borderColor: 'rgba(221,198,22,0.15)', borderRadius: 12 }} pointerEvents="none" />}
        {/* Main border */}
        {isSelected && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1.5, borderColor: THEME.primary, borderRadius: 10 }} pointerEvents="none" />}
        {/* Corner handles */}
        {isSelected && (
          <>
            {[{ top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 }, { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 }, { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 }, { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 }].map((pos, i) => (
              <View key={i} style={{ position: 'absolute', ...pos, width: HANDLE_HIT, height: HANDLE_HIT, justifyContent: 'center', alignItems: 'center' }} pointerEvents="none">
                <View style={{ width: HANDLE_SIZE, height: HANDLE_SIZE, backgroundColor: '#fff', borderWidth: 2, borderColor: THEME.primary, borderRadius: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2, elevation: 3 }} />
              </View>
            ))}
          </>
        )}
        {/* "Double-tap to edit" hint — show briefly on first select */}
        {isSelected && (
          <View style={{ position: 'absolute', bottom: -28, alignSelf: 'center', left: 0, right: 0, alignItems: 'center' }} pointerEvents="none">
            <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 }}>
              <Text style={{ color: '#ccc', fontSize: 9, fontWeight: '500' }}>Double-tap to edit text</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
});

// Initialize AdMob SDK once at module level
MobileAds().initialize().catch(() => {/* ignore init errors */});

let EXPORT_STAGES = [
  'Loading paper...',
  'Preparing ink & colors...',
  'Printing your photo...',
  'Developing colors...',
  'Finishing print...',
];

const ExportPercentText = ({ progress }: { progress: Animated.Value }) => {
  const [pct, setPct] = useState('0');
  useEffect(() => {
    const id = progress.addListener(({ value }: { value: number }) => { setPct(Math.round(value).toString()); });
    return () => progress.removeListener(id);
  }, []);
  return <Text style={{ color: THEME.primary, fontSize: 18, fontWeight: '700', marginBottom: 8, letterSpacing: 1 }}>{pct}%</Text>;
};

const ExportStageText = ({ stage }: { stage: Animated.Value }) => {
  const [text, setText] = useState(EXPORT_STAGES[0]);
  useEffect(() => {
    const id = stage.addListener(({ value }: { value: number }) => { 
      const idx = Math.min(Math.floor(value), EXPORT_STAGES.length - 1); 
      setText(EXPORT_STAGES[idx]); 
    });
    return () => stage.removeListener(id);
  }, []);
  return <Text style={{ color: THEME.textMuted, fontSize: 13, fontWeight: '500', letterSpacing: 0.3 }}>{text}</Text>;
};

// ── Pro Welcome / Celebration Screen ───────────────────────────────────────
function ProWelcomeScreen({
  purchasedPlanId,
  allPlans,
  paywallConfig,
  celebrationAnim,
  safeTop,
  safeBottom,
  onExplore,
  onUpgrade,
}: {
  purchasedPlanId: string;
  allPlans: any[];
  paywallConfig: any;
  celebrationAnim: Animated.Value;
  safeTop: number;
  safeBottom: number;
  onExplore: () => void;
  onUpgrade: (planId: string) => void;
}) {
  const PLAN_TIER: Record<string, number> = { weekly: 1, monthly: 2, yearly: 3, lifetime: 4 };
  const currentTier = PLAN_TIER[purchasedPlanId] ?? 1;
  const upsellPlans = allPlans.filter(p => (PLAN_TIER[p.id] ?? 0) > currentTier);

  const PARTICLES = [
    { angle: 0,   dist: 110, color: '#DDC616', size: 10 },
    { angle: 25,  dist: 90,  color: '#F4D86B', size: 7  },
    { angle: 50,  dist: 130, color: '#E11D48', size: 8  },
    { angle: 75,  dist: 100, color: '#fff',    size: 6  },
    { angle: 100, dist: 120, color: '#06B6D4', size: 9  },
    { angle: 130, dist: 95,  color: '#DDC616', size: 7  },
    { angle: 155, dist: 115, color: '#10B981', size: 8  },
    { angle: 180, dist: 105, color: '#F4D86B', size: 6  },
    { angle: 205, dist: 90,  color: '#8B5CF6', size: 7  },
    { angle: 235, dist: 125, color: '#E11D48', size: 8  },
    { angle: 260, dist: 100, color: '#DDC616', size: 10 },
    { angle: 285, dist: 115, color: '#06B6D4', size: 6  },
    { angle: 310, dist: 95,  color: '#F4D86B', size: 7  },
    { angle: 340, dist: 130, color: '#10B981', size: 9  },
  ];

  const logoScale = celebrationAnim.interpolate({ inputRange: [0, 0.55, 0.75, 1], outputRange: [0.1, 1.35, 0.9, 1] });
  const titleOpacity = celebrationAnim.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0, 1] });
  const titleTranslateY = celebrationAnim.interpolate({ inputRange: [0, 0.45, 1], outputRange: [28, 28, 0] });
  const upsellOpacity = celebrationAnim.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0, 0, 1] });

  const cfg = paywallConfig;
  const welcomeTitle = cfg?.welcomeTitle || 'ಅಚ್ಚು ಕನ್ನಡ Pro ಗೆ ಸ್ವಾಗತ!';
  const welcomeSubtitle = cfg?.welcomeSubtitle || 'ನಿಮ್ಮ ಸೃಜನಶೀಲ ಪ್ರಯಾಣ ಈಗ ಪ್ರಾರಂಭವಾಗಿದೆ.';
  const exploreText = cfg?.exploreButtonText || 'ಅನ್ವೇಷಿಸಿ';

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0c', alignItems: 'center', justifyContent: 'space-evenly', paddingTop: safeTop + 16, paddingBottom: safeBottom + 16, paddingHorizontal: 24 }}>
      <LinearGradient colors={['rgba(221,198,22,0.07)', 'transparent']} style={[StyleSheet.absoluteFill, { borderRadius: 0 }]} />

      {/* Confetti particles radiating from logo center */}
      <View style={{ position: 'absolute', top: '38%', left: '50%' }}>
        {PARTICLES.map((p, i) => {
          const rad = p.angle * Math.PI / 180;
          const tx = celebrationAnim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(rad) * p.dist] });
          const ty = celebrationAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -Math.sin(rad) * p.dist] });
          const op = celebrationAnim.interpolate({ inputRange: [0, 0.15, 0.65, 1], outputRange: [0, 1, 1, 0] });
          const sc = celebrationAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 1.3, 0.5] });
          return (
            <Animated.View key={i} style={{
              position: 'absolute',
              width: p.size, height: p.size,
              borderRadius: p.size / 2,
              backgroundColor: p.color,
              transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }],
              opacity: op,
            }} />
          );
        })}
      </View>

      {/* Animated logo with bounce */}
      <Animated.View style={{ transform: [{ scale: logoScale }], alignItems: 'center' }}>
        <View style={{ width: 96, height: 96, borderRadius: 30, backgroundColor: 'rgba(221,198,22,0.12)', borderWidth: 2.5, borderColor: THEME.primary, justifyContent: 'center', alignItems: 'center', shadowColor: THEME.primary, shadowOpacity: 0.65, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 14 }}>
          <Image source={{ uri: SPLASH_LOGO_URL }} style={{ width: 72, height: 72 }} resizeMode="contain" />
        </View>
        <View style={{ position: 'absolute', bottom: -8, right: -8, width: 30, height: 30, borderRadius: 15, backgroundColor: THEME.primary, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#0a0a0c', elevation: 6 }}>
          <MaterialIcons name="check" size={17} color="#0a0a0c" />
        </View>
      </Animated.View>

      {/* Welcome text */}
      <Animated.View style={{ alignItems: 'center', opacity: titleOpacity, transform: [{ translateY: titleTranslateY }] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 }}>
          <MaterialIcons name="workspace-premium" size={18} color={THEME.primary} />
          <Text style={{ color: THEME.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }}>PRO UNLOCKED</Text>
          <MaterialIcons name="workspace-premium" size={18} color={THEME.primary} />
        </View>
        <Text style={{ color: '#fff', fontSize: 23, fontWeight: '900', textAlign: 'center', letterSpacing: 0.2, lineHeight: 31 }}>{welcomeTitle}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>{welcomeSubtitle}</Text>
      </Animated.View>

      {/* Upsell plans (conditional on plan tier) */}
      {upsellPlans.length > 0 && (
        <Animated.View style={{ width: '100%', opacity: upsellOpacity }}>
          <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'center', marginBottom: 10 }}>
            Upgrade for even more
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {upsellPlans.map((plan: any) => (
              <TouchableOpacity
                key={plan.id}
                onPress={() => onUpgrade(plan.id)}
                activeOpacity={0.8}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(221,198,22,0.28)', backgroundColor: 'rgba(221,198,22,0.05)' }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{plan.label}</Text>
                <Text style={{ color: THEME.primary, fontSize: 15, fontWeight: '900', marginTop: 3 }}>{plan.price}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, marginTop: 2 }}>{plan.billing}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      )}

      {/* Explore CTA */}
      <TouchableOpacity
        onPress={onExplore}
        activeOpacity={0.9}
        style={{ width: '100%', borderRadius: 28, overflow: 'hidden', shadowColor: THEME.primary, shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 12 }}
      >
        <LinearGradient
          colors={[THEME.primary, '#F4D86B', THEME.primary]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ paddingVertical: 15, alignItems: 'center' }}
        >
          <Text style={{ color: '#0a0a0c', fontSize: 17, fontWeight: '900', letterSpacing: 0.5 }}>{exploreText}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}


function AppContent() {
      // --- Additional missing state/refs for error fixes ---
      // For Pro modal pack navigation
      const prevPackId = useRef<string | null>(null);
      // For color picker target (text shadow vs fill)
      const [colorTarget, setColorTarget] = useState<'color'|'shadowColor'|'strokeColor'|'glowColor'>('color');
      const [stickerColorTarget, setStickerColorTarget] = useState<'color'|'shadow'|'stroke'|'glow'>('color');
      // Alias for pro modal (legacy references) removed; use crownModalVisible/setCrownModalVisible directly
    // --- MISSING STATE/REFS DECLARATIONS ---
    // Refs
    const dragStartElements = useRef<CanvasElement[]>([]);
    const viewShotRef = useRef<any>(null);
    const bgTransformRef = useRef<{ x: number; y: number; scale: number; baseScale: number }>({ x: 0, y: 0, scale: 1, baseScale: 1 });
    // State
    const [defaultAdj] = useState({ brightness: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0, fade: 0, dehaze: 0, saturation: 0, vibrance: 0, clarity: 0, sharpness: 0 });
    const [activeFilter, setActiveFilter] = useState(FILTERS[0]);
    const [filterStrength, setFilterStrength] = useState(FILTERS[0].defaultStrength);
    const [currentText, setCurrentText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [printPreviewUri, setPrintPreviewUri] = useState<string|null>(null);
    const [exportUri, setExportUri] = useState<string|null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [saveSuccessVisible, setSaveSuccessVisible] = useState(false);
    const [cropRotation, setCropRotation] = useState(0);
    const [fineRotation, setFineRotation] = useState(0);
    const [cropFlipH, setCropFlipH] = useState(false);
    const [cropFlipV, setCropFlipV] = useState(false);
    const [showOriginal, setShowOriginal] = useState(false);
    const [splashText, setSplashText] = useState({ title: 'Acchu Kannada', subtitle: '', copyright: '', buttonText: 'Start Editing' });
    const [splashGradient, setSplashGradient] = useState({ colors: ['#0D0D0D', '#1a1a2e', '#16213e', '#0D0D0D'], start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
    const [exportFormat, setExportFormat] = useState<'png'|'jpg'|'pdf'>('png');
    const [exportQuality, setExportQuality] = useState(1);
    const [pdfQuality, setPdfQuality] = useState<'screen'|'print'>('screen');
    // Animated values for export animation
    const exportProgress = useRef(new Animated.Value(0)).current;
    const exportSpin = useRef(new Animated.Value(0)).current;
    const exportPulse = useRef(new Animated.Value(1)).current;
    const exportStage = useRef(new Animated.Value(0)).current;
    // Crop/Spiral state
    const [showSpiral, setShowSpiral] = useState(false);
    const [spiralRotation, setSpiralRotation] = useState(0);
    const [spiralFlipH, setSpiralFlipH] = useState(false);
    const [spiralFlipV, setSpiralFlipV] = useState(false);
    // Panel scroll lock
    const [panelScrollEnabled, setPanelScrollEnabled] = useState(true);
    // Color picker
    const [colorCategoryId, setColorCategoryId] = useState('basic');
    // Text subtab
    const [textSubTab, setTextSubTab] = useState<'fonts'|'style'|'effects'|'color'|'pro'>('fonts');
    const prevTextSubTab = useRef<'fonts'|'style'|'effects'|'color'|'pro'>('fonts');
    const [editingTemplateLine, setEditingTemplateLine] = useState<number>(-1);
    // Filter subtab
    const [filterSubTab, setFilterSubTab] = useState<'presets'|'adjust'|'pro'>('presets');
    const prevFilterSubTab = useRef<'presets'|'adjust'|'pro'>('presets');
    const [filterCategoryId, setFilterCategoryId] = useState('all');
    const [activeAdjTool, setActiveAdjTool] = useState('brightness');
    // Adjustment setter
    const setAdj = (key: keyof typeof defaultAdj, value: number) => setImgAdj(adj => ({ ...adj, [key]: value }));
    // Crown modal
    const [crownModalVisible, setCrownModalVisible] = useState(false);

    // ── THEMED ALERT STATE ──
    const [themedAlert, setThemedAlert] = useState<{
      visible: boolean;
      title: string;
      message: string;
      icon?: string;
      buttons: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[];
    }>({ visible: false, title: '', message: '', buttons: [] });

    const showThemedAlert = useCallback((
      title: string,
      message: string,
      buttons?: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[],
      icon?: string,
    ) => {
      setThemedAlert({
        visible: true,
        title,
        message,
        icon,
        buttons: buttons || [{ text: 'OK', style: 'default' }],
      });
    }, []);

    const dismissThemedAlert = useCallback(() => {
      setThemedAlert(prev => ({ ...prev, visible: false }));
    }, []);

    // ── PRO SUBSCRIPTION STATE ──
    const [isPro, setIsPro] = useState(false);
    const [paywallVisible, setPaywallVisible] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<string>('yearly');
    const [paywallConfig, setPaywallConfig] = useState<any>(null);
    const [exportConfig, setExportConfig] = useState<any>(null);
    const [proWelcomeVisible, setProWelcomeVisible] = useState(false);
    const [purchasedPlanId, setPurchasedPlanId] = useState<string>('yearly');
    const celebrationAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      AsyncStorage.getItem(PRO_STORAGE_KEY).then(v => { if (v === 'true') setIsPro(true); });
      // Initialise Google Play Billing once on mount. The listener inside
      // initBilling handles successful purchases (persist flag + finishTransaction);
      // we just mirror the flag into local state here.
      initBilling(async (purchase) => {
        setIsPro(true);
        const planId = (purchase as any)?.productId ?? 'yearly';
        setPurchasedPlanId(planId);
        celebrationAnim.setValue(0);
        Animated.spring(celebrationAnim, { toValue: 1, tension: 40, friction: 6, useNativeDriver: true }).start();
        setProWelcomeVisible(true);
      }).catch(e => console.warn('[billing] init failed', e));
    }, []);

    const requirePro = useCallback((feature?: string) => {
      if (isPro) return true;
      setPaywallVisible(true);
      return false;
    }, [isPro]);

    const gatedSetColorCategory = useCallback((catId: string) => {
      setColorCategoryId(catId);
    }, []);

    // ── PRO FEATURES STATE ──
    // Custom Presets
    const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
    const [presetNameInput, setPresetNameInput] = useState('');
    const [showSavePresetModal, setShowSavePresetModal] = useState(false);
    // HSL Per-Channel
    const [hslValues, setHslValues] = useState<Record<string, [number, number, number]>>({ ...DEFAULT_HSL });
    const [activeHslChannel, setActiveHslChannel] = useState<string>('Red');
    const [activeHslMode, setActiveHslMode] = useState<'hue'|'sat'|'lum'>('hue');
    const [activeTemplateLineIdx, setActiveTemplateLineIdx] = useState<number>(0);
    // RGB Tone Curves (17-point LUTs for GL shader)
    const [curveR, setCurveR] = useState<number[]>([...IDENTITY_CURVE_17]);
    const [curveG, setCurveG] = useState<number[]>([...IDENTITY_CURVE_17]);
    const [curveB, setCurveB] = useState<number[]>([...IDENTITY_CURVE_17]);
    const [curveMaster, setCurveMaster] = useState<number[]>([...IDENTITY_CURVE_17]);
    // Control points per channel: sparse {x,y} arrays that drive the LUT via monotone interpolation
    const DEFAULT_CURVE_CPS: { x: number; y: number }[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const [curveCpR, setCurveCpR] = useState<{ x: number; y: number }[]>([...DEFAULT_CURVE_CPS]);
    const [curveCpG, setCurveCpG] = useState<{ x: number; y: number }[]>([...DEFAULT_CURVE_CPS]);
    const [curveCpB, setCurveCpB] = useState<{ x: number; y: number }[]>([...DEFAULT_CURVE_CPS]);
    const [curveCpMaster, setCurveCpMaster] = useState<{ x: number; y: number }[]>([...DEFAULT_CURVE_CPS]);
    const [activeCurveChannel, setActiveCurveChannel] = useState<'master'|'red'|'green'|'blue'>('master');
    const [showCurveEditor, setShowCurveEditor] = useState(false);
    const [curveDragIdx, setCurveDragIdx] = useState<number | null>(null);
    // Text Design Templates
    const [textDesignTemplates, setTextDesignTemplates] = useState<TextDesignTemplate[]>([]);
    // Pro subtabs expansion
    const [proSubTab, setProSubTab] = useState<'presets'|'hsl'|'curves'|'filmstock'>('presets');

  // Per-screen guide tips (shown once per screen on first visit)
  const GUIDE_TIPS: Record<string, { icon: string; title: string; desc: string }> = {
    crop:     { icon: 'crop', title: 'Crop & Frame', desc: 'Choose an aspect ratio, pinch to zoom, and drag to reposition. Golden ratio guides help you frame perfectly.' },
    filters:  { icon: 'style', title: 'Film Filters', desc: 'Swipe through film-inspired presets and fine-tune with the Adjust tab. Try different categories!' },
    stickers: { icon: 'extension', title: 'Stickers', desc: 'Tap a sticker to add it. Pinch to resize, drag to move, and use the side handle to rotate.' },
    text:     { icon: 'format-shapes', title: 'Text', desc: 'Tap a preset or + to add text. Select it to change fonts, colors, shadows, and style.' },
    export:   { icon: 'file-download', title: 'Export', desc: 'Choose PNG, JPG, or PDF. Pick quality, then save to gallery or share directly.' },
  };
  const [seenGuides, setSeenGuides] = useState<Record<string, boolean>>({});
  const [activeGuide, setActiveGuide] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('seenGuides');
        if (raw) setSeenGuides(JSON.parse(raw));
      } catch {}
    })();
  }, []);

  const showGuideIfNeeded = (screen: string) => {
    if (!seenGuides[screen]) {
      setActiveGuide(screen);
    }
  };
  const dismissGuide = async (screen: string) => {
    setActiveGuide(null);
    const updated = { ...seenGuides, [screen]: true };
    setSeenGuides(updated);
    try { await AsyncStorage.setItem('seenGuides', JSON.stringify(updated)); } catch {}
  };

  // ── Crop apply/cancel callbacks (shared by header + bottom action bar) ──
  const cancelCrop = () => {
    setActiveTab('filters');
    setCropRotation(0); setFineRotation(0); setCropFlipH(false); setCropFlipV(false);
    setActiveRatio(null);
    bgTransformRef.current = { x: 0, y: 0, scale: 1, baseScale: 1 };
  };
  const applyCrop = async () => {
    const actions: ImageManipulator.Action[] = [];
    if (cropFlipH) actions.push({ flip: ImageManipulator.FlipType.Horizontal });
    if (cropFlipV) actions.push({ flip: ImageManipulator.FlipType.Vertical });
    if (cropRotation !== 0) {
      actions.push({ rotate: cropRotation });
    }
    // Compute auto-scale factor (must match the visual extraTransform formula)
    const _fineD = ((cropRotation % 90) + 90) % 90;
    const _effA = _fineD > 45 ? 90 - _fineD : _fineD;
    const _theta = (_effA * Math.PI) / 180;
    let applyAutoScale = 1;
    if (_theta > 0.001) {
      const _r = Math.max(renderedW / renderedH, renderedH / renderedW);
      applyAutoScale = Math.cos(_theta) + Math.sin(_theta) * _r;
    }
    const bt = bgTransformRef.current;
    const effectiveScale = bt.scale * applyAutoScale;
    const isZoomed = effectiveScale > bt.baseScale * 1.01 || Math.abs(bt.x) > 1 || Math.abs(bt.y) > 1;
    let currentW = imgDim.w, currentH = imgDim.h;
    let currentUri = bgImage;
    if (actions.length > 0) {
      const rotated = await ImageManipulator.manipulateAsync(currentUri, actions, { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG });
      currentUri = rotated.uri;
      currentW = rotated.width;
      currentH = rotated.height;
    }
    if (isZoomed) {
      const cropOriginX = (currentW / 2) - (renderedW / (2 * effectiveScale)) - (bt.x / effectiveScale);
      const cropOriginY = (currentH / 2) - (renderedH / (2 * effectiveScale)) - (bt.y / effectiveScale);
      const cropW = renderedW / effectiveScale;
      const cropH = renderedH / effectiveScale;
      const cx = Math.max(0, Math.round(cropOriginX));
      const cy = Math.max(0, Math.round(cropOriginY));
      const cw = Math.min(Math.round(cropW), currentW - cx);
      const ch = Math.min(Math.round(cropH), currentH - cy);
      if (cw > 10 && ch > 10) {
        const cropped = await ImageManipulator.manipulateAsync(currentUri, [{ crop: { originX: cx, originY: cy, width: cw, height: ch } }], { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG });
        currentUri = cropped.uri;
        currentW = cropped.width;
        currentH = cropped.height;
      }
    } else if (activeRatio) {
      // User picked a fixed aspect ratio without pinch-zooming — bake a centered
      // crop to that ratio so the editor shows the chosen framing.
      const targetRatio = activeRatio[0] / activeRatio[1];
      const currentRatio = currentW / currentH;
      if (Math.abs(targetRatio - currentRatio) > 0.001) {
        let cw: number, ch: number;
        if (targetRatio > currentRatio) {
          // Target is wider — keep width, reduce height
          cw = currentW;
          ch = Math.round(currentW / targetRatio);
        } else {
          // Target is taller — keep height, reduce width
          ch = currentH;
          cw = Math.round(currentH * targetRatio);
        }
        const cx = Math.max(0, Math.round((currentW - cw) / 2));
        const cy = Math.max(0, Math.round((currentH - ch) / 2));
        if (cw > 10 && ch > 10) {
          const cropped = await ImageManipulator.manipulateAsync(currentUri, [{ crop: { originX: cx, originY: cy, width: cw, height: ch } }], { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG });
          currentUri = cropped.uri;
          currentW = cropped.width;
          currentH = cropped.height;
        }
      }
    }
    if (currentUri !== bgImage) {
      setBgImage(currentUri);
      setImgDim({ w: currentW, h: currentH });
    }
    bgTransformRef.current = { x: 0, y: 0, scale: 1, baseScale: 1 };
    setCropRotation(0); setFineRotation(0); setCropFlipH(false); setCropFlipV(false);
    setActiveRatio(null);
    setActiveTab('filters'); showGuideIfNeeded('filters');
  };

  // Core state
  const [appState, setAppState] = useState('splash');
  const [bgImage, setBgImage] = useState('');
  const [imgDim, setImgDim] = useState({ w: 0, h: 0 });
  const [forceColorMatrix, setForceColorMatrix] = useState(false);
  const [glCaptureUri, setGlCaptureUri] = useState<string | null>(null);
  const glEditorRef = useRef<GLImageEditorHandle | null>(null);


  // Camera state
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const [cameraSaving, setCameraSaving] = useState(false);
  const [cameraFlash, setCameraFlash] = useState(false);
  const cameraRef = useRef<any>(null);
  const [camGrid, setCamGrid] = useState(false);
  const [camGolden, setCamGolden] = useState(false);
  const [camSpiral, setCamSpiral] = useState(false);
  const [camSpiralRotation, setCamSpiralRotation] = useState(0);
  const [camRatio, setCamRatio] = useState<'full' | '4:3' | '1:1' | '16:9'>('full');
  const [camTimer, setCamTimer] = useState<0 | 3 | 5 | 10>(0);
  const [camTimerCountdown, setCamTimerCountdown] = useState(0);
  const [camZoom, setCamZoom] = useState(0);
  const [camFocusPoint, setCamFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const camFocusAnim = useRef(new Animated.Value(0)).current;
  const camTimerRef = useRef<any>(null);
  const [camShowSettings, setCamShowSettings] = useState(false);
  // Advanced camera states
  const [camHDR, setCamHDR] = useState(false);
  const [camWB, setCamWB] = useState<'auto' | 'sunny' | 'cloudy' | 'shadow' | 'fluorescent' | 'incandescent'>('auto');
  const [camLevelEnabled, setCamLevelEnabled] = useState(false);
  const [camLevelAngle, setCamLevelAngle] = useState(0);
  const [camHistogram, setCamHistogram] = useState(false);
  const [camCapturedPhoto, setCamCapturedPhoto] = useState<{ uri: string; width: number; height: number } | null>(null);
  const camAccelSub = useRef<any>(null);
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [past, setPast] = useState<CanvasElement[][]>([]);
  const [future, setFuture] = useState<CanvasElement[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { setEditingTemplateLine(-1); }, [selectedId]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupEditMode, setGroupEditMode] = useState(false);
  const groupDragRef = useRef({ dx: 0, dy: 0, ds: 1, dr: 0 });
  const [, setGroupDragTick] = useState(0);
  const [activeTab, setActiveTab] = useState<'crop'|'filters'|'adjust'|'pro'|'text'|'stickers'>('filters');
  const [adjOpenSection, setAdjOpenSection] = useState<'light'|'color'|'detail'>('light');
  const [proActiveSection, setProActiveSection] = useState<string | null>(null);
  const [activeRatio, setActiveRatio] = useState<[number, number] | null>(null);
  const [imgAdj, setImgAdj] = useState({ brightness: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0, fade: 0, dehaze: 0, saturation: 0, vibrance: 0, clarity: 0, sharpness: 0 });

  // Combined color matrix for subject cutout overlay — mirrors DraggableBackground's adjustmentMatrix
  const cutoutAdjMatrix = useMemo(() => {
    const matrices: any[] = [];
    const { brightness, contrast, highlights, shadows, temp, tint, fade, dehaze, saturation, vibrance, clarity, sharpness } = imgAdj;
    if (activeFilter.matrix && filterStrength > 0) matrices.push(lerpMatrix(activeFilter.matrix, filterStrength));
    if (brightness !== 0) { const br = brightness * 0.25; if (br > 0) { const g = 1 - br * 0.7; matrices.push([g,0,0,0,br, 0,g,0,0,br, 0,0,g,0,br, 0,0,0,1,0]); } else { const g = 1 + br * 0.7; matrices.push([g,0,0,0,br*0.3, 0,g,0,0,br*0.3, 0,0,g,0,br*0.3, 0,0,0,1,0]); } }
    if (contrast !== 0) { const c = 1 + contrast * 0.35; const t = 0.5*(1-c); matrices.push([c,0,0,0,t, 0,c,0,0,t, 0,0,c,0,t, 0,0,0,1,0]); }
    if (highlights !== 0) { const h = highlights * 0.25; matrices.push([1+h,0,0,0,-h*0.5, 0,1+h,0,0,-h*0.5, 0,0,1+h,0,-h*0.5, 0,0,0,1,0]); }
    if (shadows !== 0) { const s = shadows * 0.25; matrices.push([1-s*0.3,0,0,0,s*0.35, 0,1-s*0.3,0,0,s*0.35, 0,0,1-s*0.3,0,s*0.35, 0,0,0,1,0]); }
    if (fade > 0) { const fl = fade * 0.15; const fm = fade * 0.06; matrices.push([1-fm,0,0,0,fl+fm*0.5, 0,1-fm,0,0,fl+fm*0.5, 0,0,1-fm,0,fl+fm*0.5, 0,0,0,1,0]); }
    if (dehaze !== 0) { const dc = 1 + dehaze * 0.3; const dO = (1-dc)*0.5; matrices.push([dc,0,0,0,dO, 0,dc,0,0,dO, 0,0,dc,0,dO, 0,0,0,1,0]); const ds = 1 + dehaze * 0.15; const lr=0.2126,lg=0.7152,lb=0.0722; const dsr=(1-ds)*lr,dsg=(1-ds)*lg,dsb=(1-ds)*lb; matrices.push([dsr+ds,dsg,dsb,0,0, dsr,dsg+ds,dsb,0,0, dsr,dsg,dsb+ds,0,0, 0,0,0,1,0]); if (dehaze > 0) matrices.push([1,0,0,0,-dehaze*0.05, 0,1,0,0,-dehaze*0.05, 0,0,1,0,-dehaze*0.05, 0,0,0,1,0]); }
    if (saturation !== 0) { const s = 1 + saturation * 0.5; const lr=0.2126,lg=0.7152,lb=0.0722; const sr=(1-s)*lr,sg=(1-s)*lg,sb=(1-s)*lb; matrices.push([sr+s,sg,sb,0,0, sr,sg+s,sb,0,0, sr,sg,sb+s,0,0, 0,0,0,1,0]); }
    if (vibrance !== 0) { const v = 1 + vibrance * 0.35; const lr=0.2126,lg=0.7152,lb=0.0722; const vr=(1-v)*lr,vg=(1-v)*lg,vb=(1-v)*lb; matrices.push([vr+v,vg,vb,0,0, vr,vg+v,vb,0,0, vr,vg,vb+v,0,0, 0,0,0,1,0]); }
    if (temp !== 0) { const tw = temp * 0.08; matrices.push([1,0,0,0,tw, 0,1,0,0,tw*0.02, 0,0,1,0,-tw, 0,0,0,1,0]); }
    if (tint !== 0) { const ti = tint * 0.06; matrices.push([1,0,0,0,ti, 0,1,0,0,-Math.abs(ti)*0.8, 0,0,1,0,ti, 0,0,0,1,0]); }
    if (clarity !== 0) { const cc = 1 + clarity * 0.2; const co = (1-cc)*0.5; matrices.push([cc,0,0,0,co, 0,cc,0,0,co, 0,0,cc,0,co, 0,0,0,1,0]); const cs = 1 + clarity * 0.08; const lr=0.2126,lg=0.7152,lb=0.0722; const csr=(1-cs)*lr,csg=(1-cs)*lg,csb=(1-cs)*lb; matrices.push([csr+cs,csg,csb,0,0, csr,csg+cs,csb,0,0, csr,csg,csb+cs,0,0, 0,0,0,1,0]); }
    if (sharpness !== 0) { const sc = 1 + sharpness * 0.15; const so = (1-sc)*0.5; matrices.push([sc,0,0,0,so, 0,sc,0,0,so, 0,0,sc,0,so, 0,0,0,1,0]); }
    if (matrices.length === 0) return null;
    if (matrices.length === 1) return matrices[0];
    return concatColorMatrices(...matrices);
  }, [imgAdj, activeFilter, filterStrength]);

  // GL uniforms for the subject cutout overlay — same pipeline as the background
  const cutoutGlUniforms = useMemo<GLEditorUniforms>(() => ({
    brightness: imgAdj.brightness || 0,
    contrast: imgAdj.contrast || 0,
    highlights: imgAdj.highlights || 0,
    shadows: imgAdj.shadows || 0,
    saturation: imgAdj.saturation || 0,
    vibrance: imgAdj.vibrance || 0,
    temp: imgAdj.temp || 0,
    tint: imgAdj.tint || 0,
    fade: imgAdj.fade || 0,
    dehaze: imgAdj.dehaze || 0,
    clarity: imgAdj.clarity || 0,
    sharpness: imgAdj.sharpness || 0,
    grain: 0, grainSize: 0, grainRoughness: 0, grainColor: 0,
    filterStrength: filterStrength || 0,
    filterMatrix: activeFilter.matrix || null,
    hslRed: hslValues?.Red || [0,0,0],
    hslOrange: hslValues?.Orange || [0,0,0],
    hslYellow: hslValues?.Yellow || [0,0,0],
    hslGreen: hslValues?.Green || [0,0,0],
    hslAqua: hslValues?.Aqua || [0,0,0],
    hslBlue: hslValues?.Blue || [0,0,0],
    hslPurple: hslValues?.Purple || [0,0,0],
    hslMagenta: hslValues?.Magenta || [0,0,0],
    curveR: curveR || IDENTITY_CURVE_17,
    curveG: curveG || IDENTITY_CURVE_17,
    curveB: curveB || IDENTITY_CURVE_17,
    curveMaster: curveMaster || IDENTITY_CURVE_17,
  }), [imgAdj, activeFilter, filterStrength, hslValues, curveR, curveG, curveB, curveMaster]);

  const [customHue, setCustomHue] = useState(0);
  const [customSat, setCustomSat] = useState(0);
  const [customVal, setCustomVal] = useState(0);
  const [customGradColor1, setCustomGradColor1] = useState('#FF6B6B');
  const [customGradColor2, setCustomGradColor2] = useState('#FFE66D');
  const [customGradHue1, setCustomGradHue1] = useState(0);
  const [customGradHue2, setCustomGradHue2] = useState(52);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [fontList, setFontList] = useState<any[]>([...CORE_FONTS]);
  const [fontCategories, setFontCategories] = useState<FontCategory[]>([]);
  const [activeFontCategoryId, setActiveFontCategoryId] = useState('');
  const [packs, setPacks] = useState<PackData[]>([]);
  const [activePackId, setActivePackId] = useState('');
  const [textPresets, setTextPresets] = useState<any[]>([]);
  const textPresetTextsRef = useRef<{ text: string }[]>([]);
  const [colorCategories, setColorCategories] = useState(DEFAULT_COLOR_CATEGORIES);
  const [cloudGradients, setCloudGradients] = useState<{ id: string; name: string; colors: string[] }[]>([]);
  const [cloudFreeFilters, setCloudFreeFilters]       = useState<typeof FILTERS>([]);
  const [cloudProFilters,  setCloudProFilters]        = useState<typeof FILTERS>([]);
  const [subjectCutoutUri, setSubjectCutoutUri] = useState<string | null>(null);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [maskEditorVisible, setMaskEditorVisible] = useState(false);
  const [subjectMaskUri, setSubjectMaskUri] = useState<string | null>(null);
  const [maskBrushMode, setMaskBrushMode] = useState<'add' | 'erase'>('add');
  const [maskBrushSize, setMaskBrushSize] = useState(22);
  const [edgePrecision, setEdgePrecision] = useState<'soft' | 'normal' | 'hard'>('normal');
  const [maskStrokes, setMaskStrokes] = useState<{x: number; y: number; size: number; mode: 'add' | 'erase'}[][]>([]);
  const [currentMaskStroke, setCurrentMaskStroke] = useState<{x: number; y: number; size: number; mode: 'add' | 'erase'}[]>([]);
  const maskViewShotRef = useRef<any>(null);
  const [maskImageLayout, setMaskImageLayout] = useState({ w: 0, h: 0, x: 0, y: 0 });
  // Zoom & pan state for mask editor
  const [maskZoom, setMaskZoom] = useState(1);
  const [maskPanOff, setMaskPanOff] = useState({ x: 0, y: 0 });
  const maskGestureRef = useRef({ isPinching: false, lastDist: 0, lastMid: { x: 0, y: 0 }, baseZoom: 1, basePan: { x: 0, y: 0 } });
  // All state and refs are now declared at the top of AppContent. Remove duplicate/old state here.

  // ── Text Behind Subject: generate foreground cutout via ML Kit Subject Segmentation ──
  const generateSubjectCutout = useCallback(async (imageUri: string) => {
    if (isSegmenting) return;
    setIsSegmenting(true);
    try {
      const uri = imageUri.startsWith('file://') || imageUri.startsWith('content://') ? imageUri : `file://${imageUri}`;
      const SubjectSeg = NativeModules.SubjectSegmentation;
      if (!SubjectSeg) {
        showThemedAlert('Behind Subject', 'Subject segmentation module not available. Please rebuild the app.', undefined, 'error-outline');
        return;
      }
      const resultUri: string = await SubjectSeg.segment(uri, edgePrecision);
      if (resultUri) {
        setSubjectCutoutUri(resultUri);
      }
      // Also generate the grayscale mask for editing
      try {
        const maskUri: string = await SubjectSeg.segmentMask(uri, edgePrecision);
        if (maskUri) setSubjectMaskUri(maskUri);
      } catch (_) {}
    } catch (e: any) {
      console.warn('Subject segmentation failed:', e);
      showThemedAlert('Behind Subject', 'Could not segment the subject from this image. Please try a different photo.', undefined, 'person-off');
    } finally {
      setIsSegmenting(false);
    }
  }, [isSegmenting, edgePrecision]);

  const openMaskEditor = useCallback(() => {
    if (!subjectMaskUri && bgImage) {
      // Generate mask first if not available
      const uri = bgImage.startsWith('file://') || bgImage.startsWith('content://') ? bgImage : `file://${bgImage}`;
      const SubjectSeg = NativeModules.SubjectSegmentation;
      if (SubjectSeg) {
        setIsSegmenting(true);
        SubjectSeg.segmentMask(uri).then((maskUri: string) => {
          setSubjectMaskUri(maskUri);
          setMaskStrokes([]);
          setCurrentMaskStroke([]);
          setMaskZoom(1);
          setMaskPanOff({ x: 0, y: 0 });
          setMaskEditorVisible(true);
        }).catch(() => {
          showThemedAlert('Mask Editor', 'Could not generate mask.', undefined, 'error-outline');
        }).finally(() => setIsSegmenting(false));
      }
    } else {
      setMaskStrokes([]);
      setCurrentMaskStroke([]);
      setMaskZoom(1);
      setMaskPanOff({ x: 0, y: 0 });
      setMaskEditorVisible(true);
    }
  }, [subjectMaskUri, bgImage]);

  const applyRefinedMask = useCallback(async () => {
    if (!maskViewShotRef.current || !bgImage) return;
    setIsSegmenting(true);
    try {
      const capturedMask = await maskViewShotRef.current.capture({ format: 'png', quality: 1, result: 'tmpfile' });
      const maskUri = capturedMask.startsWith('file://') ? capturedMask : `file://${capturedMask}`;
      const imgUri = bgImage.startsWith('file://') || bgImage.startsWith('content://') ? bgImage : `file://${bgImage}`;
      const SubjectSeg = NativeModules.SubjectSegmentation;
      const cutoutUri: string = await SubjectSeg.applyMask(imgUri, maskUri);
      if (cutoutUri) {
        setSubjectCutoutUri(cutoutUri);
        setSubjectMaskUri(maskUri);
      }
      setMaskEditorVisible(false);
    } catch (e: any) {
      showThemedAlert('Mask Editor', 'Failed to apply mask: ' + (e.message || ''), undefined, 'error-outline');
    } finally {
      setIsSegmenting(false);
    }
  }, [bgImage]);

  const maskBrushRef = useRef({ mode: maskBrushMode, size: maskBrushSize, layout: maskImageLayout, zoom: maskZoom, panOff: maskPanOff });
  maskBrushRef.current = { mode: maskBrushMode, size: maskBrushSize, layout: maskImageLayout, zoom: maskZoom, panOff: maskPanOff };
  const maskStrokesRef = useRef(maskStrokes);
  maskStrokesRef.current = maskStrokes;

  const maskPanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onShouldBlockNativeResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      // First finger down — start drawing (pinch detection happens in onMove)
      maskGestureRef.current.isPinching = false;
      const { locationX, locationY } = e.nativeEvent;
      const { mode, size, zoom } = maskBrushRef.current;
      setCurrentMaskStroke([{ x: locationX, y: locationY, size: size / zoom, mode }]);
    },
    onPanResponderMove: (e, gs) => {
      const numTouches = gs.numberActiveTouches;
      const touches = e.nativeEvent.touches;

      if (numTouches >= 2 && touches && touches.length >= 2) {
        // ── Pinch-to-zoom + two-finger pan ──
        const t0 = touches[0];
        const t1 = touches[1];
        const dx = t1.pageX - t0.pageX;
        const dy = t1.pageY - t0.pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midX = (t0.pageX + t1.pageX) / 2;
        const midY = (t0.pageY + t1.pageY) / 2;
        const g = maskGestureRef.current;

        if (!g.isPinching) {
          // Transition from drawing to pinch
          g.isPinching = true;
          g.lastDist = dist;
          g.lastMid = { x: midX, y: midY };
          g.baseZoom = maskBrushRef.current.zoom;
          g.basePan = { ...maskBrushRef.current.panOff };
          setCurrentMaskStroke([]); // cancel any in-progress stroke
          return;
        }

        const scale = dist / Math.max(g.lastDist, 1);
        const newZoom = Math.min(Math.max(g.baseZoom * scale, 1), 5);
        const panDx = midX - g.lastMid.x;
        const panDy = midY - g.lastMid.y;
        const { layout } = maskBrushRef.current;
        const maxPanX = (layout.w * (newZoom - 1)) / 2;
        const maxPanY = (layout.h * (newZoom - 1)) / 2;
        const nx = Math.min(Math.max(g.basePan.x + panDx, -maxPanX), maxPanX);
        const ny = Math.min(Math.max(g.basePan.y + panDy, -maxPanY), maxPanY);
        setMaskZoom(newZoom);
        setMaskPanOff({ x: nx, y: ny });

      } else if (!maskGestureRef.current.isPinching && numTouches === 1) {
        // ── Single-finger draw with smooth interpolation ──
        const { locationX, locationY } = e.nativeEvent;
        const { mode, size, zoom } = maskBrushRef.current;
        const brushR = size / zoom;
        setCurrentMaskStroke(prev => {
          if (prev.length === 0) return [{ x: locationX, y: locationY, size: brushR, mode }];
          const last = prev[prev.length - 1];
          const ddx = locationX - last.x;
          const ddy = locationY - last.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          const step = Math.max(brushR / 6, 1.5);
          if (d < step) return prev;
          const steps = Math.ceil(d / step);
          const pts: typeof prev = [];
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            pts.push({ x: last.x + ddx * t, y: last.y + ddy * t, size: brushR, mode });
          }
          return [...prev, ...pts];
        });
      }
    },
    onPanResponderRelease: (e, gs) => {
      if (maskGestureRef.current.isPinching) {
        // If one finger lifts while still pinching, don't commit stroke
        if (gs.numberActiveTouches <= 1) {
          maskGestureRef.current.isPinching = false;
        }
        return;
      }
      setCurrentMaskStroke(prev => {
        if (prev.length > 0) {
          setMaskStrokes(s => [...s, prev]);
        }
        return [];
      });
    },
  })).current;

  // Clear cutout when image changes
  useEffect(() => {
    setSubjectCutoutUri(null);
    setSubjectMaskUri(null);
  }, [bgImage]);

  // Accelerometer-based level indicator
  useEffect(() => {
    if (appState === 'camera' && camLevelEnabled) {
      Accelerometer.setUpdateInterval(100);
      camAccelSub.current = Accelerometer.addListener(({ x }) => {
        // x ≈ 0 when device is level; convert to degrees
        const degrees = Math.round(Math.asin(Math.max(-1, Math.min(1, x))) * (180 / Math.PI));
        setCamLevelAngle(degrees);
      });
      return () => { camAccelSub.current?.remove(); camAccelSub.current = null; };
    } else {
      camAccelSub.current?.remove();
      camAccelSub.current = null;
      setCamLevelAngle(0);
    }
  }, [appState, camLevelEnabled]);

  // Derived state (already declared above, so just use):
  // const activeTextEl = ...
  // const activeAnyEl = ...
  // const activeActualFont = ...

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function loadLocalFonts() {
      try {
        await Font.loadAsync({
          'ATSSmooth': require('./assets/fonts/ATSBengaluru-SmoothRegular.ttf'),
          'Hubballi': require('./assets/fonts/Hubballi-Regular.ttf'),
          'NotoSans': require('./assets/fonts/NotoSansKannada.ttf'),
          'Padyakke': require('./assets/fonts/PadyakkeExpandedOne-Regular.ttf'),
        });

        try {
          const data = await cachedFetch(CLOUD_FONTS_URL, '@cache_fonts', signal);
            const baseUrl = data.baseUrl || '';
            const dynamicFonts: any[] = [];
            const parsedCategories: FontCategory[] = [];
            const fontLoadPromises: Promise<void>[] = [];



            // Support both new format (categories[]) and old format (cloudFonts[])
            const categories: any[] = data.categories || [];
            if (categories.length === 0 && data.cloudFonts) {
              let currentCat: any = null;
              for (const font of data.cloudFonts) {
                if (font.value.startsWith('dummy')) {
                  currentCat = { id: font.value, name: font.label.replace(/-/g, '').trim(), fonts: [] };
                  categories.push(currentCat);
                } else if (currentCat) {
                  currentCat.fonts.push(font);
                } else {
                  if (categories.length === 0) categories.push({ id: 'default', name: 'All', fonts: [] });
                  categories[0].fonts.push(font);
                }
              }
            }

            for (const cat of categories) {
              const category: FontCategory = { id: cat.id, name: cat.name, fonts: [] };
              for (const font of (cat.fonts || [])) {
                let fontUrl = font.file ? (font.file.startsWith('http') ? font.file : baseUrl + font.file) : (font.url || '');
                fontUrl = fixGithubUrl(fontUrl);
                const isBuiltIn = CORE_FONTS.some(cf => cf.value === font.value);
                if (!isBuiltIn && fontUrl && fontUrl.trim() !== '') {
                  fontLoadPromises.push(
                    Font.loadAsync({ [font.value]: { uri: fontUrl.trim() } })
                      .then(() => console.log('Cloud font loaded', font.value))
                      .catch((fontErr: any) => console.warn('Failed to load cloud font', font.value, fontUrl, fontErr))
                  );
                }
                const fontObj = { 
                  label: font.label, 
                  value: font.value, 
                  boldValue: font.value,
                  isPremium: font.isPremium || false
                };
                if (!dynamicFonts.some(df => df.value === font.value) && !isBuiltIn) {
                  dynamicFonts.push(fontObj);
                }
                if (!category.fonts.some(f => f.value === font.value)) {
                  category.fonts.push(fontObj);
                }
              }
              parsedCategories.push(category);
            }
            await Promise.allSettled(fontLoadPromises);
            if (!signal.aborted) {
              setFontList([...CORE_FONTS, ...dynamicFonts]);
              if (parsedCategories.length > 0) setActiveFontCategoryId(parsedCategories[0].id);
              setFontCategories(parsedCategories);
            }
        } catch (err) {
          // Offline fallback
        }
      } catch (e) {
         console.log("Error loading fonts", e);
      } finally { 
        setFontsLoaded(true); 
        await SplashScreen.hideAsync(); 
      }
    }
    loadLocalFonts();

    cachedFetch(CLOUD_SPLASH_TEXT_URL, '@cache_splash_text', signal).then(data => { if (data && !signal.aborted) setSplashText((prev: any) => ({ ...prev, ...data })); }).catch(() => {});
    cachedFetch(CLOUD_SPLASH_CONFIG_URL, '@cache_splash_config', signal).then(data => { if (data?.gradient && !signal.aborted) setSplashGradient(data.gradient); }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (appState === 'splash') { const timer = setTimeout(() => { setAppState('home'); }, 5000); return () => clearTimeout(timer); }
  }, [appState]);

  // ── Load user presets from storage ──
  useEffect(() => {
    AsyncStorage.getItem('@user_presets').then(raw => {
      if (raw) {
        try { setUserPresets(JSON.parse(raw)); } catch {}
      }
    }).catch(() => {});
  }, []);

  const saveUserPreset = async (name: string) => {
    const preset: UserPreset = {
      id: `up_${Date.now()}`,
      name: name.trim() || `Preset ${userPresets.length + 1}`,
      createdAt: Date.now(),
      adjustments: { ...imgAdj },
      filterId: activeFilter.id,
      filterStrength,
      hsl: { ...hslValues },
      curveR: [...curveR],
      curveG: [...curveG],
      curveB: [...curveB],
      curveMaster: [...curveMaster],
    };
    const updated = [preset, ...userPresets];
    setUserPresets(updated);
    try { await AsyncStorage.setItem('@user_presets', JSON.stringify(updated)); } catch {}
  };

  const applyUserPreset = (preset: UserPreset) => {
    setImgAdj(preset.adjustments as any);
    const filter = allFilters.find(f => f.id === preset.filterId);
    if (filter) { setActiveFilter(filter); setFilterStrength(preset.filterStrength); }
    if (preset.hsl) setHslValues(preset.hsl);
    if (preset.curveR) setCurveR(preset.curveR);
    if (preset.curveG) setCurveG(preset.curveG);
    if (preset.curveB) setCurveB(preset.curveB);
    if (preset.curveMaster) setCurveMaster(preset.curveMaster);
  };

  const deleteUserPreset = async (id: string) => {
    const updated = userPresets.filter(p => p.id !== id);
    setUserPresets(updated);
    try { await AsyncStorage.setItem('@user_presets', JSON.stringify(updated)); } catch {}
  };

  // ── Custom font upload ──
  const uploadCustomFont = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['font/ttf', 'font/otf', 'application/x-font-ttf', 'application/x-font-opentype', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      const fontName = file.name.replace(/\.(ttf|otf)$/i, '').replace(/[^a-zA-Z0-9]/g, '_');
      await Font.loadAsync({ [fontName]: { uri: file.uri } });
      const newFont = { label: file.name.replace(/\.(ttf|otf)$/i, ''), value: fontName, boldValue: fontName, isCustom: true };
      setFontList(prev => {
        if (prev.some(f => f.value === fontName)) return prev;
        return [...prev, newFont];
      });
      // Add to a "Custom" category
      setFontCategories(prev => {
        const customCat = prev.find(c => c.id === 'custom_uploads');
        if (customCat) {
          return prev.map(c => c.id === 'custom_uploads' ? { ...c, fonts: [...c.fonts, newFont] } : c);
        }
        return [...prev, { id: 'custom_uploads', name: '📁 My Fonts', fonts: [newFont] }];
      });
      showThemedAlert('Font Loaded', `"${newFont.label}" is now available in your font list.`, undefined, 'check-circle');
    } catch (e: any) {
      showThemedAlert('Upload Failed', 'Could not load the font file. Make sure it is a valid .ttf or .otf file.', undefined, 'error-outline');
    }
  };

  // ── Load text design templates from cloud JSON (cached, with bundled fallback) ──
  // Wait for fonts to load first so template fonts from cloud are available
  useEffect(() => {
    if (!fontsLoaded) return;
    const fallback: TextDesignTemplate[] = require('./assets/textDesignTemplates.json').templates || [];
    setTextDesignTemplates(fallback); // show bundled instantly
    cachedFetch(CLOUD_TEXT_DESIGN_TEMPLATES_URL, '@cache_text_design_templates').then(async (data) => {
      if (data?.templates && Array.isArray(data.templates) && data.templates.length > 0) {
        // Pre-load any template fonts that aren't already loaded
        const loadedFontNames = fontList.map((f: any) => f.value);
        const templateFontNames = new Set<string>();
        for (const tpl of data.templates) {
          for (const line of tpl.lines || []) {
            if (line.fontFamily && !loadedFontNames.includes(line.fontFamily)) {
              templateFontNames.add(line.fontFamily);
            }
          }
        }
        if (templateFontNames.size > 0) {
          const fontPromises = Array.from(templateFontNames).map(async (fontName: string) => {
            // Try to find font URL from fontCategories
            for (const cat of fontCategories) {
              const found = cat.fonts.find((f: any) => f.value === fontName);
              if (found) return; // already in categories = already loaded
            }
            // Font not found in categories — skip, it may be a bundled font name
          });
          await Promise.allSettled(fontPromises);
        }
        setTextDesignTemplates(data.templates);
      }
    }).catch(() => {}); // keep bundled fallback on network failure
  }, [fontsLoaded]);

  // Re-apply random font styles to text presets when cloud fonts finish loading
  useEffect(() => {
    if (textPresetTextsRef.current.length > 0 && fontList.length > 4) {
      const presets = textPresetTextsRef.current.map((item, i) => {
        const style = randomPresetStyle(i, fontList.map(f => f.value));
        return { id: `cp_${i}`, text: item.text, ...style };
      });
      setTextPresets(presets);
    }
  }, [fontList]);

  // Handle shared image intent from gallery/file manager
  useEffect(() => {
    const checkSharedIntent = async () => {
      try {
        const { ShareIntentModule } = NativeModules;
        if (!ShareIntentModule) return;
        const uri = await ShareIntentModule.getSharedImageUri();
        if (!uri) return;
        ShareIntentModule.clearSharedIntent();
        // Normalize image same as launchPicker
        const MAX_TEX = 4096;
        const info = await new Promise<{width: number; height: number}>((resolve) => {
          Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), () => resolve({ width: 1080, height: 1920 }));
        });
        const actions: ImageManipulator.Action[] = [];
        if (info.width > MAX_TEX || info.height > MAX_TEX) {
          if (info.width >= info.height) actions.push({ resize: { width: MAX_TEX } });
          else actions.push({ resize: { height: MAX_TEX } });
        }
        const normalized = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG });
        setBgImage(normalized.uri);
        setImgDim({ w: normalized.width, h: normalized.height });
        setElements([]);
        setPast([]);
        setFuture([]);
        setSelectedId(null);
        setActiveRatio(null);
        setImgAdj(defaultAdj);
        setActiveFilter(FILTERS[0]);
        setFilterStrength(FILTERS[0].defaultStrength);
        setAppState('editor');
        setActiveTab('crop');
      } catch (e) {
        console.log('Share intent error:', e);
      }
    };
    // Wait for splash to finish, then check for shared intent
    if (appState === 'home') checkSharedIntent();
  }, [appState]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    Promise.allSettled([
      cachedFetch(CLOUD_DATABASE_URL, '@cache_stickers', signal).then(async (data) => {
        if (signal.aborted) return;
        const baseUrl = (data.baseUrl || '').replace(/\/?$/, '/');
        const allPacks = (data.packs || []).map((pack: any) => ({
          ...pack,
          stickers: pack.stickers.map((s: any) => ({
            ...s,
            src: fixGithubUrl(s.src.startsWith('http') ? s.src : baseUrl + s.src),
            isTintable: s.isTintable ?? pack.isTintable ?? false,
          })),
        }));
        // Validate sticker URLs and filter out broken ones
        const validatedPacks: any[] = [];
        for (const pack of allPacks) {
          const checks = await Promise.allSettled(
            pack.stickers.map((s: any) => fetchWithTimeout(s.src, { method: 'HEAD', signal }, 5000).then(r => r.ok))
          );
          const validStickers = pack.stickers.filter((_: any, i: number) => checks[i].status === 'fulfilled' && (checks[i] as PromiseFulfilledResult<boolean>).value);
          if (validStickers.length > 0) validatedPacks.push({ ...pack, stickers: validStickers });
        }
        if (!signal.aborted) {
          setPacks(validatedPacks);
          if (validatedPacks.length > 0) setActivePackId(validatedPacks[0].id);
          // Prefetch sticker images for instant rendering
          const allUrls = validatedPacks.flatMap((p: any) => p.stickers.map((s: any) => s.src));
          allUrls.forEach((url: string) => Image.prefetch(url).catch(() => {}));
        }
      }),
      cachedFetch(CLOUD_TEXT_PRESETS_URL, '@cache_textpresets', signal).then(data => {
        if (signal.aborted) return;
        const hour = new Date().getHours();
        const timeOfDay = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
        
        // Get today's special day (if any)
        const specialDays: any[] = data.specialDays || [];
        const today = new Date();
        const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const activeSpecialDay = specialDays.find((sd: any) => sd.date === todayStr);
        
        let display: { text: string }[] = [];
        
        // Support new categories format: { categories: { morning: [...], evening: [...], ugadi: [...] } }
        const cats = data.categories;
        const timeKeys = ['morning', 'afternoon', 'evening', 'night'];
        const specialIds = specialDays.map((sd: any) => sd.id);
        if (cats && typeof cats === 'object' && !Array.isArray(cats)) {
          // Special day category first
          if (activeSpecialDay && cats[activeSpecialDay.id]) {
            display.push(...cats[activeSpecialDay.id]);
          }
          // Time-of-day category
          if (cats[timeOfDay]) display.push(...cats[timeOfDay]);
          // General
          if (cats['general']) display.push(...cats['general']);
          // Always-show categories (not time, not general, not special day)
          const reservedKeys = new Set([...timeKeys, 'general', ...specialIds]);
          for (const key of Object.keys(cats)) {
            if (!reservedKeys.has(key)) display.push(...cats[key]);
          }
        } else {
          // Fallback: old flat textPresets[] format
          const raw = data.textPresets || [];
          const parsed = raw.map((item: any) => typeof item === 'string' ? { text: item } : item);
          display.push(...parsed);
        }
        
        // Deduplicate by text
        const seen = new Set<string>();
        display = display.filter(p => { if (seen.has(p.text)) return false; seen.add(p.text); return true; });
        
        const presets = display.map((item, i) => {
          const style = randomPresetStyle(i, fontList.map(f => f.value));
          return { id: `cp_${i}`, text: item.text, ...style };
        });
        textPresetTextsRef.current = display;
        setTextPresets(presets);
      }),
      cachedFetch(CLOUD_COLORS_URL, '@cache_colors', signal).then(data => {
        if (signal.aborted) return;
        const cats = data.categories || data;
        if (Array.isArray(cats) && cats.length > 0 && cats[0].id && cats[0].colors) {
          setColorCategories(cats);
        }
      }),
      cachedFetch(CLOUD_GRADIENTS_URL, '@cache_gradients', signal).then(data => {
        if (signal.aborted) return;
        if (Array.isArray(data) && data.length > 0) {
          setCloudGradients(data);
          // Merge gradient colors into color categories
          const gradientColors = data.map((g: any) => `gradient:${g.colors[0]},${g.colors[1]}`);
          setColorCategories(prev => {
            const existing = prev.find(c => c.id === 'gradient');
            if (existing) {
              return prev.map(c => c.id === 'gradient' ? { ...c, colors: gradientColors } : c);
            }
            return [...prev, { id: 'gradient', label: '✨ Gradient', colors: gradientColors }];
          });
        }
      }),
      cachedFetch(CLOUD_FREE_FILTERS_URL, '@cache_free_filters', signal).then(data => {
        if (signal.aborted) return;
        if (Array.isArray(data) && data.length > 0) {
          setCloudFreeFilters(data.map((f: any) => ({
            id: f.id, label: f.label, previewColor: f.previewColor,
            defaultStrength: f.defaultStrength ?? 1.0, matrix: f.matrix,
          })));
        }
      }),
      cachedFetch(CLOUD_PRO_FILTERS_URL, '@cache_pro_filters', signal).then(data => {
        if (signal.aborted) return;
        if (Array.isArray(data) && data.length > 0) {
          setCloudProFilters(data.map((f: any) => ({
            id: f.id, label: f.label, previewColor: f.previewColor,
            defaultStrength: f.defaultStrength ?? 1.0, matrix: f.matrix,
          })));
        }
      }),
      cachedFetch(CLOUD_PAYWALL_CONFIG_URL, '@cache_paywall_config', signal).then(data => {
        if (signal.aborted || !data) return;
        setPaywallConfig(data);
      }).catch(() => {}),
      cachedFetch(CLOUD_EXPORT_CONFIG_URL, '@cache_export_config', signal).then(data => {
        if (signal.aborted || !data) return;
        if (Array.isArray(data.exportStages) && data.exportStages.length > 0) {
          EXPORT_STAGES = data.exportStages;
        }
        setExportConfig(data);
      }).catch(() => {}),
    ]).catch(() => {});

    return () => controller.abort();
  }, []);

  // Safe area insets — must be called before any early return (Rules of Hooks)
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // Combine static filters with cloud-loaded filters (free + pro override bundled versions)
  const allFilters = useMemo(() => {
    const freeFilters = cloudFreeFilters.length > 0 ? cloudFreeFilters : FILTERS.filter(f => !f.id.startsWith('pro_'));
    const proFilters  = cloudProFilters.length > 0  ? cloudProFilters  : FILTERS.filter(f => f.id.startsWith('pro_'));
    return [...freeFilters, ...proFilters];
  }, [cloudFreeFilters, cloudProFilters]);

  const allPremiumFilterIds = useMemo(() => {
    const proSource = cloudProFilters.length > 0 ? cloudProFilters : FILTERS.filter(f => f.id.startsWith('pro_'));
    const ids = new Set(proSource.map(f => f.id));
    return ids;
  }, [cloudProFilters]);

  // Build filter categories (always static)
  const allFilterCategories = useMemo(() => FILTER_CATEGORIES, []);

  // ── Detect if any pro feature is actively used in the composition ──
  const hasProFeaturesInUse = useMemo(() => {
    if (isPro) return false;
    // Premium filter active?
    if (activeFilter.id !== 'none' && allPremiumFilterIds.has(activeFilter.id)) return true;
    // HSL in use?
    if (HSL_CHANNELS.some(ch => (hslValues[ch.key] || [0,0,0]).some((v: number) => v !== 0))) return true;
    // Curves in use?
    if (curveR.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01)) return true;
    if (curveG.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01)) return true;
    if (curveB.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01)) return true;
    if (curveMaster.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01)) return true;
    // Check canvas elements for pro features
    for (const el of elements) {
      // Premium font?
      if (el.type === 'text' && el.fontFamily) {
        const fontEntry = fontList.find(f => f.value === el.fontFamily);
        const isFontPremium = fontEntry ? (fontEntry.isPremium === true) : false;
        if (isFontPremium) return true;
      }
      // Gradient color?
      if (el.color?.startsWith('gradient:')) return true;
      // Behind subject?
      if (el.behindSubject) return true;
      // 3D transform?
      if ((el.rotateX && el.rotateX !== 0) || (el.rotateY && el.rotateY !== 0) || (el.rotateZ && el.rotateZ !== 0)) return true;
      // Sticker from premium pack?
      if (el.type === 'image' && el.isPremiumPack) return true;
      // Sticker effects (shadow/stroke/glow)?
      if (el.type === 'image' && ((el.strokeWidth && el.strokeWidth > 0) || (el.glowRadius && el.glowRadius > 0) || (el.shadowBlur && el.shadowBlur > 0))) return true;
    }
    return false;
  }, [isPro, activeFilter, allPremiumFilterIds, elements, fontList, hslValues, curveR, curveG, curveB, curveMaster]);

  // ── Remove all pro features from the composition ──
  const removeProFeatures = useCallback(() => {
    // Reset premium filter
    if (activeFilter.id !== 'none' && allPremiumFilterIds.has(activeFilter.id)) {
      setActiveFilter(FILTERS[0]); // Reset to 'none'
    }
    // Reset HSL & curves
    setHslValues({ ...DEFAULT_HSL });
    setCurveR([...IDENTITY_CURVE_17]);
    setCurveG([...IDENTITY_CURVE_17]);
    setCurveB([...IDENTITY_CURVE_17]);
    setCurveMaster([...IDENTITY_CURVE_17]);
    // Clean elements
    setElements(prev => prev
      .filter(el => !(el.type === 'image' && el.isPremiumPack)) // Remove premium stickers
      .map(el => {
        const updated = { ...el };
        // Reset premium font to core font
        if (el.type === 'text' && el.fontFamily) {
          const fontEntry = fontList.find(f => f.value === el.fontFamily);
          if (fontEntry?.isPremium === true) updated.fontFamily = 'Padyakke';
        }
        // Reset gradient color to white
        if (el.color?.startsWith('gradient:')) {
          updated.color = '#FFFFFF';
        }
        // Remove behind subject
        if (el.behindSubject) updated.behindSubject = false;
        // Reset 3D transform
        if (el.rotateX) updated.rotateX = 0;
        if (el.rotateY) updated.rotateY = 0;
        if (el.rotateZ) updated.rotateZ = 0;
        // Remove sticker effects
        if (el.type === 'image') {
          if (el.strokeWidth) updated.strokeWidth = 0;
          if (el.glowRadius) updated.glowRadius = 0;
          if (el.shadowBlur) { updated.shadowBlur = 0; updated.shadowDistance = 0; }
        }
        return updated;
      })
    );
  }, [activeFilter, allPremiumFilterIds, fontList]);

  // Apply color respecting template lines — must be before early return (Rules of Hooks)
  const applyColorTarget = useCallback((color: string) => {
    if (!selectedId) return;
    const el = elements.find(e => e.id === selectedId);
    if (el?.templateLines && el.templateLines.length > 0 && colorTarget === 'color') {
      const newLines = [...el.templateLines];
      const idx = Math.min(activeTemplateLineIdx, newLines.length - 1);
      newLines[idx] = { ...newLines[idx], color };
      commitHistory(prev => prev.map(e => e.id === selectedId ? { ...e, templateLines: newLines } : e));
    } else {
      if (selectedId) commitHistory(prev => prev.map(el => el.id === selectedId ? { ...el, [colorTarget]: color } : el));
    }
  }, [selectedId, elements, colorTarget, activeTemplateLineIdx]);

  if (!fontsLoaded) return null;

  const safeTop = Math.max(insets.top, STATUS_BAR_HEIGHT);
  const safeBottom = Math.max(insets.bottom, 10);
  const safeLeft = Math.max(insets.left, SAFE_HORIZONTAL_PADDING);
  const safeRight = Math.max(insets.right, SAFE_HORIZONTAL_PADDING);
  // Uniform bottom panel height across all tabs (including crop) — prevents canvas resize/image scaling bugs
  const bottomPanelH = BOTTOM_PANEL_HEIGHT;
  const headerH = HEADER_HEIGHT;

  const MAX_W = width - safeLeft - safeRight;
  const MAX_H = height - (safeTop + headerH + bottomPanelH + safeBottom);
  const aspectToUse = activeRatio ? (activeRatio[0] / activeRatio[1]) : (imgDim.h ? imgDim.w / imgDim.h : 1);
  let renderedW = MAX_W, renderedH = MAX_H;
  if (aspectToUse > (MAX_W / MAX_H)) { renderedH = MAX_W / aspectToUse; } else { renderedW = MAX_H * aspectToUse; }


  // --- Handlers and logic using top-level state/refs ---
  const commitHistory = (updater: (prev: CanvasElement[]) => CanvasElement[]) => {
    setElements(prev => {
      const next = updater(prev);
      if (next === prev) return prev;
      setPast(p => [...p, prev]);
      setFuture([]);
      return next;
    });
  };
  const undo = () => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast(past.slice(0, past.length - 1));
    setFuture([elements, ...future]);
    setElements(previous);
    setSelectedId(null);
  };
  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, elements]);
    setElements(next);
    setSelectedId(null);
  };
  const handleSliderStart = () => {
    setElements(prev => {
      dragStartElements.current = prev;
      return prev;
    });
  };
  const handleSliderComplete = () => {
    setPast(p => [...p, dragStartElements.current]);
    setFuture([]);
  };

  const launchPicker = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
    if (!result.canceled && result.assets.length > 0) {
      // Normalize image: fix EXIF rotation (Samsung cameras) + convert to JPEG
      // + limit size for GL texture compatibility
      const picked = result.assets[0];
      const MAX_TEX = 4096;
      const actions: ImageManipulator.Action[] = [];
      if (picked.width > MAX_TEX || picked.height > MAX_TEX) {
        if (picked.width >= picked.height) {
          actions.push({ resize: { width: MAX_TEX } });
        } else {
          actions.push({ resize: { height: MAX_TEX } });
        }
      }
      const normalized = await ImageManipulator.manipulateAsync(
        picked.uri,
        actions,
        { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
      );
      setBgImage(normalized.uri);
      setImgDim({ w: normalized.width, h: normalized.height });
      setElements([]);
      setPast([]);
      setFuture([]);
      setSelectedId(null);
      setActiveRatio(null);
      setImgAdj(defaultAdj);
      setActiveFilter(FILTERS[0]);
      setFilterStrength(FILTERS[0].defaultStrength);
      setAppState('editor');
      setActiveTab('crop');
      showGuideIfNeeded('crop');
    }
  };

  const launchCamera = async () => {
    if (!cameraPermission?.granted) {
      const perm = await requestCameraPermission();
      if (!perm.granted) {
        showThemedAlert('Permission Needed', 'Camera permission is required to take photos.', undefined, 'camera-alt');
        return;
      }
    }
    setCameraFacing('back');
    setCameraFlash(false);
    setCamZoom(0);
    setCamTimerCountdown(0);
    setCamShowSettings(false);
    setCamCapturedPhoto(null);
    setCamHDR(false);
    setCamWB('auto');
    setAppState('camera');
  };

  const handleCamTapToFocus = (evt: any) => {
    const { locationX, locationY } = evt.nativeEvent;
    setCamFocusPoint({ x: locationX, y: locationY });
    camFocusAnim.setValue(0);
    Animated.sequence([
      Animated.timing(camFocusAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(800),
      Animated.timing(camFocusAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setCamFocusPoint(null));
  };

  const takePictureWithTimer = () => {
    if (cameraSaving || camTimerCountdown > 0) return;
    if (camTimer === 0) {
      takePicture();
      return;
    }
    setCamTimerCountdown(camTimer);
    let remaining = camTimer;
    camTimerRef.current = setInterval(() => {
      remaining -= 1;
      setCamTimerCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(camTimerRef.current);
        takePicture();
      }
    }, 1000);
  };

  const takePicture = async () => {
    if (!cameraRef.current || cameraSaving) return;
    setCameraSaving(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1, skipProcessing: false });

      let finalUri = photo.uri;
      let finalW = photo.width;
      let finalH = photo.height;

      // Crop to match the visible zoomed portion so the editor shows exactly what the user saw
      if (camZoom > 0) {
        const zoomFactor = 1 + camZoom * 7; // matches the viewfinder display formula
        const cropW = Math.round(photo.width / zoomFactor);
        const cropH = Math.round(photo.height / zoomFactor);
        const originX = Math.round((photo.width - cropW) / 2);
        const originY = Math.round((photo.height - cropH) / 2);
        const cropped = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ crop: { originX, originY, width: cropW, height: cropH } }],
          { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
        );
        finalUri = cropped.uri;
        finalW = cropped.width;
        finalH = cropped.height;
      }

      setCamCapturedPhoto({ uri: finalUri, width: finalW, height: finalH });
    } catch (err: any) {
      showThemedAlert('Error', err.message || 'Could not take photo.', undefined, 'error-outline');
    }
    setCameraSaving(false);
  };

  const sendCapturedToEditor = async () => {
    if (!camCapturedPhoto) return;
    const photo = camCapturedPhoto;
    setCamCapturedPhoto(null);
    // Normalize for editor (same as launchPicker flow)
    const MAX_TEX = 4096;
    const actions: ImageManipulator.Action[] = [];
    if (photo.width > MAX_TEX || photo.height > MAX_TEX) {
      if (photo.width >= photo.height) {
        actions.push({ resize: { width: MAX_TEX } });
      } else {
        actions.push({ resize: { height: MAX_TEX } });
      }
    }
    const normalized = await ImageManipulator.manipulateAsync(
      photo.uri,
      actions,
      { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
    );
    setBgImage(normalized.uri);
    setImgDim({ w: normalized.width, h: normalized.height });
    setElements([]);
    setPast([]);
    setFuture([]);
    setSelectedId(null);
    setActiveRatio(null);
    setImgAdj(defaultAdj);
    setActiveFilter(FILTERS[0]);
    setFilterStrength(FILTERS[0].defaultStrength);
    setAppState('editor');
    setActiveTab('crop');
  };

  const commitText = () => {
    if (currentText && currentText.trim() !== '') {
      commitHistory(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          type: 'text',
          content: currentText,
          color: '#FFFFFF',
          fontFamily: 'Hubballi',
          isBold: false,
          isItalic: false,
          isUnderline: false,
          textAlign: 'center',
          opacity: 1,
          fontSize: 45,
          lineHeight: 75,
          letterSpacing: 0,
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          width: 250,
          shadowColor: '#000000',
          shadowBlur: 0,
          shadowDistance: 0,
          shadowAngle: 45,
          shadowOpacity: 0,
          behindSubject: false,
        },
      ]);
      setActiveTab('text');
    }
    setCurrentText('');
    setIsTyping(false);
  };
  const updateSelectedStyle = (key: keyof CanvasElement, value: any) => {
    if (selectedId) setElements(prev => prev.map(el => el.id === selectedId ? { ...el, [key]: value } : el));
  };
  const updateStyleWithHistory = (key: keyof CanvasElement, value: any) => {
    if (selectedId) commitHistory(prev => prev.map(el => el.id === selectedId ? { ...el, [key]: value } : el));
  };
  const toggleShadow = (isOn: boolean) => {
    if (!selectedId) return;
    if (isOn) {
      const rAngle = Math.round(Math.random() * 24) * 15;
      const rDist = Math.round(3 + Math.random() * 15);
      const rOpacity = Math.round((0.3 + Math.random() * 0.5) * 10) / 10;
      commitHistory(prev => prev.map(el => el.id === selectedId ? {
        ...el,
        shadowOpacity: rOpacity,
        shadowAngle: rAngle,
        shadowDistance: rDist,
        shadowBlur: Math.round(1 + Math.random() * 9),
        shadowColor: el.shadowColor || '#000000',
      } : el));
    } else {
      commitHistory(prev => prev.map(el => el.id === selectedId ? { ...el, shadowOpacity: 0 } : el));
    }
  };
  const toggleStroke = (isOn: boolean) => {
    if (!selectedId) return;
    if (isOn) {
      commitHistory(prev => prev.map(el => el.id === selectedId ? {
        ...el,
        strokeWidth: 2,
        strokeColor: el.strokeColor || '#000000',
      } : el));
    } else {
      commitHistory(prev => prev.map(el => el.id === selectedId ? { ...el, strokeWidth: 0 } : el));
    }
  };
  const toggleGlow = (isOn: boolean) => {
    if (!selectedId) return;
    if (isOn) {
      commitHistory(prev => prev.map(el => el.id === selectedId ? {
        ...el,
        glowRadius: 8,
        glowOpacity: 0.7,
        glowColor: el.glowColor || '#FFFFFF',
      } : el));
    } else {
      commitHistory(prev => prev.map(el => el.id === selectedId ? { ...el, glowOpacity: 0 } : el));
    }
  };
  const duplicateElement = () => {
    if (!selectedId) return;
    let newId = Date.now().toString();
    commitHistory(prev => {
      const target = prev.find(e => e.id === selectedId);
      if (!target) return prev;
      return [...prev, { ...target, id: newId, x: target.x + 30, y: target.y + 30 }];
    });
    setTimeout(() => setSelectedId(newId), 0);
  };
  const deleteElement = () => {
    if (selectedGroupId && !groupEditMode) {
      // Delete entire group
      commitHistory(prev => prev.filter(e => e.groupId !== selectedGroupId));
      setSelectedGroupId(null); setSelectedId(null); setGroupEditMode(false);
      return;
    }
    if (!selectedId) return;
    commitHistory(prev => {
      const el = prev.find(e => e.id === selectedId);
      const remaining = prev.filter(e => e.id !== selectedId);
      // If this was the last element in a group, clear group selection
      if (el?.groupId && !remaining.some(e => e.groupId === el.groupId)) {
        setSelectedGroupId(null); setGroupEditMode(false);
      }
      return remaining;
    });
    setSelectedId(null);
  };
  const moveLayer = (direction: 'up' | 'down') => {
    if (!selectedId) return;
    commitHistory(prev => {
      const idx = prev.findIndex(e => e.id === selectedId);
      if (idx < 0) return prev;
      const newArr = [...prev];
      if (direction === 'up' && idx < newArr.length - 1) {
        [newArr[idx], newArr[idx + 1]] = [newArr[idx + 1], newArr[idx]];
      } else if (direction === 'down' && idx > 0) {
        [newArr[idx], newArr[idx - 1]] = [newArr[idx - 1], newArr[idx]];
      }
      return newArr;
    });
  };

  const prepareExport = async () => {
    if (!viewShotRef.current) return;
    // If free user has pro features active, prompt to upgrade or remove
    if (hasProFeaturesInUse) {
      showThemedAlert(
        'Pro ಫೀಚರ್‌ಗಳು ಪತ್ತೆಯಾಗಿವೆ',
        'ನಿಮ್ಮ ರಚನೆಯು Pro ಫೀಚರ್‌ಗಳನ್ನು ಬಳಸುತ್ತದೆ. ಎಕ್ಸ್‌ಪೋರ್ಟ್ ಮಾಡಲು Pro ಗೆ ಅಪ್‌ಗ್ರೇಡ್ ಮಾಡಿ, ಅಥವಾ ಉಚಿತ ಆವೃತ್ತಿಯೊಂದಿಗೆ ಮುಂದುವರಿಯಲು Pro ಫೀಚರ್‌ಗಳನ್ನು ತೆಗೆದುಹಾಕಿ.',
        [
          { text: 'Pro ಗೆ ಅಪ್‌ಗ್ರೇಡ್ ಮಾಡಿ', style: 'default', onPress: () => setPaywallVisible(true) },
          { text: 'Pro ಫೀಚರ್‌ಗಳನ್ನು ತೆಗೆದುಹಾಕಿ', style: 'destructive', onPress: () => {
            removeProFeatures();
            showThemedAlert('ಮುಗಿಯಿತು', 'Pro ಫೀಚರ್‌ಗಳನ್ನು ತೆಗೆದುಹಾಕಲಾಗಿದೆ. ಈಗ ನೀವು ನಿಮ್ಮ ರಚನೆಯನ್ನು ಎಕ್ಸ್‌ಪೋರ್ಟ್ ಮಾಡಬಹುದು.', undefined, 'check-circle');
          }},
          { text: 'ರದ್ದುಮಾಡಿ', style: 'cancel' },
        ],
        'auto-awesome',
      );
      return;
    }
    showGuideIfNeeded('export');
    setSelectedId(null);
    try {
      // Single-capture path: ViewShot directly on the live canvas (GLView + overlays).
      // On modern Android (API 26+) ViewShot's hardware renderer captures GLView
      // correctly. We avoid an intermediate GL snapshot because it doubles the
      // bitmap memory footprint and gets the process OOM-killed on 4 GB devices.
      let capturedUri: string | null = null;
      try {
        capturedUri = await (viewShotRef.current as any).capture();
      } catch (liveErr) {
        console.warn('Live ViewShot capture failed:', liveErr);
      }
      if (!capturedUri) {
        // Fallback: force RN <ColorMatrix> fallback and retry. Approximate colors
        // but works when GLView can't be captured.
        setForceColorMatrix(true);
        await new Promise(resolve => setTimeout(resolve, 450));
        try {
          capturedUri = await (viewShotRef.current as any).capture();
        } catch (fbErr) {
          console.warn('ColorMatrix fallback capture failed:', fbErr);
        }
      }
      if (!capturedUri) {
        throw new Error('Capture returned no URI');
      }
      setPrintPreviewUri(capturedUri);
      setExportUri(capturedUri);
    } catch (err) {
      setForceColorMatrix(false);
      setGlCaptureUri(null);
      showThemedAlert('Error', 'Failed to capture image.', undefined, 'error-outline');
    }
  };

  const runExportAnimation = (): Promise<void> => {
    // Minimum animation duration: 10s for Pro, 30s for free (ad plays during free)
    const ANIMATION_DURATION = isPro ? 10000 : 30000;
    const STAGE_COUNT = 5;
    const STAGE_DELAY = Math.floor(ANIMATION_DURATION / STAGE_COUNT);
    return new Promise((resolve) => {
      setIsExporting(true);
      exportProgress.setValue(0);
      exportSpin.setValue(0);
      exportPulse.setValue(1);
      exportStage.setValue(0);

      Animated.loop(Animated.timing(exportSpin, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true })).start();
      Animated.loop(Animated.sequence([
        Animated.timing(exportPulse, { toValue: 1.15, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(exportPulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])).start();
      Animated.timing(exportProgress, { toValue: 100, duration: ANIMATION_DURATION, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: false }).start();
      Animated.sequence([
        Animated.delay(0),
        Animated.timing(exportStage, { toValue: 1, duration: 1, useNativeDriver: false }),
        Animated.delay(STAGE_DELAY),
        Animated.timing(exportStage, { toValue: 2, duration: 1, useNativeDriver: false }),
        Animated.delay(STAGE_DELAY),
        Animated.timing(exportStage, { toValue: 3, duration: 1, useNativeDriver: false }),
        Animated.delay(STAGE_DELAY),
        Animated.timing(exportStage, { toValue: 4, duration: 1, useNativeDriver: false }),
      ]).start();

      setTimeout(() => {
        setIsExporting(false);
        exportSpin.stopAnimation();
        exportPulse.stopAnimation();
        resolve();
      }, ANIMATION_DURATION);
    });
  };
  const saveToGallery = async () => {
    if (!exportUri) return;
    const savedUri = exportUri;
    setExportUri(null);
    setForceColorMatrix(false);
    setGlCaptureUri(null);
    await runExportAnimation();
    try {
      if (exportFormat === 'pdf') {
        const base64 = await new ExpoFile(savedUri).base64();
        // Use actual canvas dimensions scaled by PDF quality
        const scale = pdfQuality === 'print' ? 4 : 2;
        const imgW = renderedW * scale;
        const imgH = renderedH * scale;
        // A4 page in points (72 DPI)
        const pageW = 595;
        const pageH = 842;
        const html = `<html><head><style>@page{margin:0;size:${pageW}pt ${pageH}pt}body{margin:0;padding:0;display:flex;justify-content:center;align-items:center;width:${pageW}pt;height:${pageH}pt;background:#000}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="data:image/png;base64,${base64}" width="${imgW}" height="${imgH}" /></body></html>`;
        const { uri: pdfUri } = await Print.printToFileAsync({ html, width: pageW, height: pageH });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(pdfUri, { mimeType: 'application/pdf', dialogTitle: 'Save PDF' });
        } else {
          showThemedAlert('PDF Created', 'PDF saved to: ' + pdfUri, undefined, 'picture-as-pdf');
        }
        return;
      }
      const { status } = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      if (status === 'granted') {
        const formattedUri = savedUri.startsWith('file://') ? savedUri : `file://${savedUri}`;
        const asset = await MediaLibrary.createAssetAsync(formattedUri);
        await MediaLibrary.createAlbumAsync('Acchu Kannada', asset, false);
        setSaveSuccessVisible(true);
      } else {
        showThemedAlert('Permission Needed', 'We need media library permissions to save the image.', undefined, 'folder');
      }
    } catch (err: any) { showThemedAlert('Save Error', err.message || 'Could not save image.', undefined, 'error-outline'); }
  };
  const shareImage = async () => {
    if (!exportUri) return;
    const uri = exportUri;
    setExportUri(null);
    setForceColorMatrix(false);
    setGlCaptureUri(null);
    await runExportAnimation();
    if (await Sharing.isAvailableAsync()) { await Sharing.shareAsync(uri); } else { showThemedAlert('Unavailable', 'Sharing is not available on this device.', undefined, 'share'); }
  };

  const activeTextEl = elements.find(el => el.id === selectedId && el.type === 'text');
  const activeAnyEl = elements.find(el => el.id === selectedId);

  // WYSIWYG Fix: Safely figure out the true active font to pass to the text input
  const activeActualFont = activeTextEl 
    ? (activeTextEl.isBold ? fontList.find((f:any) => f.value === activeTextEl.fontFamily)?.boldValue || activeTextEl.fontFamily : activeTextEl.fontFamily) 
    : 'Hubballi';

  return (
    <View style={[styles.container, { paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: THEME.bgBase }]}>
      {/* Per-screen guide tip overlay */}
      {activeGuide && GUIDE_TIPS[activeGuide] && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 900, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)' }} pointerEvents="box-none">
          <TouchableWithoutFeedback onPress={() => dismissGuide(activeGuide)}>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          </TouchableWithoutFeedback>
          <View style={{ backgroundColor: THEME.bgSurface, borderRadius: 20, padding: 24, marginHorizontal: 32, maxWidth: 340, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(221,198,22,0.25)', elevation: 10 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(221,198,22,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
              <MaterialIcons name={GUIDE_TIPS[activeGuide].icon as any} size={24} color={THEME.primary} />
            </View>
            <Text style={{ color: THEME.primary, fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center', letterSpacing: 0.3 }}>{GUIDE_TIPS[activeGuide].title}</Text>
            <Text style={{ color: THEME.textMain, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20, opacity: 0.85 }}>{GUIDE_TIPS[activeGuide].desc}</Text>
            <TouchableOpacity onPress={() => dismissGuide(activeGuide)} style={{ backgroundColor: THEME.primary, paddingHorizontal: 32, paddingVertical: 10, borderRadius: 16 }}>
              <Text style={{ color: THEME.bgBase, fontSize: 14, fontWeight: '700' }}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <StatusBar barStyle="light-content" translucent={true} />
      
      {appState === 'camera' ? (() => {
        // Visual zoom factor � applied via transform so viewfinder exactly matches the cropped photo
        const zoomFactor = 1 + camZoom * 7;
        const camAspect = camRatio === '4:3' ? 4/3 : camRatio === '1:1' ? 1 : camRatio === '16:9' ? 16/9 : 0;
        const camViewW = width;
        const camViewH = camAspect > 0 ? Math.min(height, camViewW * camAspect) : height;
        const camViewTop = camAspect > 0 ? (height - camViewH) / 2 : 0;
        const guideColor = 'rgba(200,200,200,0.45)';

        return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <TouchableWithoutFeedback onPress={handleCamTapToFocus}>
            {/* overflow:hidden clips the scaled CameraView so the visible area matches the crop */}
            <View style={{ flex: 1, overflow: 'hidden' }}>
              <CameraView
                ref={cameraRef}
                style={{ flex: 1, transform: [{ scale: zoomFactor }] }}
                facing={cameraFacing}
                flash={cameraFlash ? 'on' : 'off'}
                enableTorch={camHDR && cameraFacing === 'back'}
              />
              {/* White balance tint overlay */}
              {camWB !== 'auto' && (
                <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: camWB === 'sunny' ? 'rgba(255,200,50,0.08)' : camWB === 'cloudy' ? 'rgba(180,200,255,0.08)' : camWB === 'shadow' ? 'rgba(150,180,255,0.1)' : camWB === 'fluorescent' ? 'rgba(200,255,200,0.06)' : 'rgba(255,180,100,0.1)' }} pointerEvents="none" />
              )}

              {/* Aspect ratio mask — dark bars */}
              {camAspect > 0 && (<>
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: camViewTop, backgroundColor: 'rgba(0,0,0,0.7)' }} pointerEvents="none" />
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: camViewTop, backgroundColor: 'rgba(0,0,0,0.7)' }} pointerEvents="none" />
              </>)}

              {/* Composition guides overlay — all overlays can be active together */}
              {(camGrid || camGolden || camSpiral) && (
                <View style={{ position: 'absolute', top: camViewTop, left: 0, width: camViewW, height: camViewH }} pointerEvents="none">
                  {/* Rule of thirds grid */}
                  {camGrid && (<>
                    <View style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, backgroundColor: guideColor }} />
                    <View style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1, backgroundColor: guideColor }} />
                    <View style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, backgroundColor: guideColor }} />
                    <View style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1, backgroundColor: guideColor }} />
                    {[1/3, 2/3].map(x => [1/3, 2/3].map(y => (
                      <View key={`${x}-${y}`} style={{ position: 'absolute', left: camViewW * x - 3, top: camViewH * y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' }} />
                    )))}
                  </>)}

                  {/* Golden ratio lines */}
                  {camGolden && (<>
                    <View style={{ position: 'absolute', left: '38.2%', top: 0, bottom: 0, width: 1, backgroundColor: guideColor }} />
                    <View style={{ position: 'absolute', left: '61.8%', top: 0, bottom: 0, width: 1, backgroundColor: guideColor }} />
                    <View style={{ position: 'absolute', top: '38.2%', left: 0, right: 0, height: 1, backgroundColor: guideColor }} />
                    <View style={{ position: 'absolute', top: '61.8%', left: 0, right: 0, height: 1, backgroundColor: guideColor }} />
                    <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${camViewW} ${camViewH}`}>
                      <Path d={`M0 0 L${camViewW} ${camViewH}`} stroke={guideColor} strokeWidth={0.8} fill="none" />
                      <Path d={`M${camViewW} 0 L0 ${camViewH}`} stroke={guideColor} strokeWidth={0.8} fill="none" />
                    </Svg>
                  </>)}

                  {/* Fibonacci spiral with rotation */}
                  {camSpiral && (
                    <Svg style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${camSpiralRotation}deg` }] }]} viewBox={`0 0 ${camViewW} ${camViewH}`}>
                      {(() => {
                        const w = camViewW, h = camViewH;
                        const phi = 1.618033988749895;
                        const b = Math.log(phi) / (Math.PI / 2);
                        const spCx = w * 0.382, spCy = h * 0.618;
                        const maxR = Math.max(w, h) * 0.78;
                        const quarters = 7;
                        const maxTheta = quarters * (Math.PI / 2);
                        const a = maxR / Math.exp(b * maxTheta);
                        const N = 180;
                        let d = '';
                        for (let i = 0; i <= N; i++) {
                          const theta = (i / N) * maxTheta;
                          const r = a * Math.exp(b * theta);
                          const angle = -theta + Math.PI;
                          const x = spCx + r * Math.cos(angle);
                          const y = spCy + r * Math.sin(angle);
                          d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
                        }
                        return <Path d={d} stroke="rgba(200,200,200,0.5)" strokeWidth={1.5} fill="none" />;
                      })()}
                    </Svg>
                  )}
                </View>
              )}

              {/* Tap-to-focus indicator */}
              {camFocusPoint && (
                <Animated.View style={{ position: 'absolute', left: camFocusPoint.x - 36, top: camFocusPoint.y - 36, width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: THEME.primary, opacity: camFocusAnim, transform: [{ scale: camFocusAnim.interpolate({ inputRange: [0, 1], outputRange: [1.5, 1] }) }] }} pointerEvents="none" />
              )}

              {/* Timer countdown display */}
              {camTimerCountdown > 0 && (
                <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' }} pointerEvents="none">
                  <Text style={{ fontSize: 80, fontWeight: '900', color: 'rgba(255,255,255,0.7)' }}>{camTimerCountdown}</Text>
                </View>
              )}

              {/* Level indicator (accelerometer-based horizon) */}
              {camLevelEnabled && (
                <View style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
                  <View style={{ width: width * 0.6, height: 2, borderRadius: 1, backgroundColor: Math.abs(camLevelAngle) <= 1 ? '#00FF88' : Math.abs(camLevelAngle) <= 3 ? THEME.primary : '#FF4444', transform: [{ rotate: `${camLevelAngle}deg` }] }} />
                  <View style={{ position: 'absolute', top: -10, backgroundColor: Math.abs(camLevelAngle) <= 1 ? 'rgba(0,255,136,0.25)' : 'rgba(0,0,0,0.5)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                    <Text style={{ color: Math.abs(camLevelAngle) <= 1 ? '#00FF88' : '#fff', fontSize: 10, fontWeight: '700' }}>{camLevelAngle > 0 ? '+' : ''}{camLevelAngle}°</Text>
                  </View>
                </View>
              )}

              {/* Histogram overlay */}
              {camHistogram && (
                <View style={{ position: 'absolute', top: safeTop + 56, left: 16, width: 100, height: 60, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: 4, flexDirection: 'row', alignItems: 'flex-end', gap: 1 }} pointerEvents="none">
                  {/* Simulated exposure guide bars */}
                  {[0.2, 0.4, 0.7, 1.0, 0.9, 0.6, 0.35, 0.15, 0.3, 0.5, 0.8, 0.95, 0.7, 0.45, 0.2, 0.1].map((h, i) => (
                    <View key={i} style={{ flex: 1, height: `${h * 100}%`, backgroundColor: i < 5 ? 'rgba(100,100,255,0.7)' : i < 11 ? 'rgba(200,200,200,0.7)' : 'rgba(255,100,100,0.7)', borderRadius: 1 }} />
                  ))}
                  <Text style={{ position: 'absolute', bottom: -14, left: 0, right: 0, textAlign: 'center', color: '#aaa', fontSize: 7, fontWeight: '600' }}>HISTOGRAM</Text>
                </View>
              )}
            </View>
          </TouchableWithoutFeedback>

          {/* ── Top bar ── */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: safeTop + 6, paddingBottom: 10, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10, backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <TouchableOpacity onPress={() => { if (camTimerRef.current) clearInterval(camTimerRef.current); setCamTimerCountdown(0); setAppState('home'); }} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' }}>
              <MaterialIcons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              {/* Flash */}
              <TouchableOpacity onPress={() => setCameraFlash(f => !f)} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: cameraFlash ? 'rgba(221,198,22,0.25)' : 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name={cameraFlash ? 'flash-on' : 'flash-off'} size={22} color={cameraFlash ? THEME.primary : '#fff'} />
              </TouchableOpacity>
              {/* Timer */}
              <TouchableOpacity onPress={() => setCamTimer(t => t === 0 ? 3 : t === 3 ? 5 : t === 5 ? 10 : 0)} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: camTimer > 0 ? 'rgba(221,198,22,0.25)' : 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name="timer" size={22} color={camTimer > 0 ? THEME.primary : '#fff'} />
                {camTimer > 0 && <Text style={{ position: 'absolute', bottom: 6, right: 5, fontSize: 8, fontWeight: '900', color: THEME.primary }}>{camTimer}s</Text>}
              </TouchableOpacity>
              {/* Flip */}
              <TouchableOpacity onPress={() => setCameraFacing(f => f === 'back' ? 'front' : 'back')} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name="flip-camera-android" size={22} color="#fff" />
              </TouchableOpacity>
              {/* Settings */}
              <TouchableOpacity onPress={() => setCamShowSettings(v => !v)} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: camShowSettings ? 'rgba(221,198,22,0.25)' : 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                <MaterialIcons name="tune" size={22} color={camShowSettings ? THEME.primary : '#fff'} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Settings panel (WB + Pro tools) ── */}
          {camShowSettings && (
            <View style={{ position: 'absolute', top: safeTop + 62, right: 12, backgroundColor: 'rgba(15,15,15,0.93)', borderRadius: 18, padding: 16, width: 236, maxHeight: height * 0.55, zIndex: 20 }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* White Balance */}
                <Text style={{ color: '#888', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8, textTransform: 'uppercase' }}>White Balance</Text>
                <View style={{ flexDirection: 'row', gap: 5, marginBottom: 16, flexWrap: 'wrap' }}>
                  {([
                    { id: 'auto' as const, label: 'Auto', icon: 'wb-auto' },
                    { id: 'sunny' as const, label: 'Day', icon: 'wb-sunny' },
                    { id: 'cloudy' as const, label: 'Cloud', icon: 'wb-cloudy' },
                    { id: 'shadow' as const, label: 'Shade', icon: 'wb-shade' },
                    { id: 'fluorescent' as const, label: 'Fluo', icon: 'wb-iridescent' },
                    { id: 'incandescent' as const, label: 'Tung', icon: 'wb-incandescent' },
                  ] as const).map(wb => (
                    <TouchableOpacity key={wb.id} onPress={() => { if (!isPro && wb.id !== 'auto') { requirePro(); return; } setCamWB(wb.id); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: camWB === wb.id ? 'rgba(221,198,22,0.2)' : 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: camWB === wb.id ? THEME.primary : 'transparent' }}>
                      <MaterialIcons name={wb.icon as any} size={13} color={camWB === wb.id ? THEME.primary : '#aaa'} />
                      <Text style={{ color: camWB === wb.id ? THEME.primary : '#aaa', fontSize: 10, fontWeight: '600', marginLeft: 3 }}>{wb.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Pro tools */}
                <Text style={{ color: '#888', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8, textTransform: 'uppercase' }}>Pro Tools {!isPro ? '🔒' : ''}</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {[
                    { key: 'hdr', label: 'HDR', icon: 'hdr-on', active: camHDR, onPress: () => { if (!isPro) { requirePro(); return; } setCamHDR(v => !v); } },
                    { key: 'level', label: 'Level', icon: 'straighten', active: camLevelEnabled, onPress: () => { if (!isPro) { requirePro(); return; } setCamLevelEnabled(v => !v); } },
                    { key: 'hist', label: 'Histogram', icon: 'equalizer', active: camHistogram, onPress: () => { if (!isPro) { requirePro(); return; } setCamHistogram(v => !v); } },
                  ].map(t => (
                    <TouchableOpacity key={t.key} onPress={t.onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: t.active ? 'rgba(221,198,22,0.2)' : 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: t.active ? THEME.primary : 'transparent' }}>
                      <MaterialIcons name={t.icon as any} size={14} color={t.active ? THEME.primary : '#aaa'} />
                      <Text style={{ color: t.active ? THEME.primary : '#aaa', fontSize: 10, fontWeight: '600', marginLeft: 4 }}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* ── Bottom controls ── */}
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.78)', paddingBottom: safeBottom + 8 }}>

            {/* Composition guides row */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 7, paddingTop: 10, paddingBottom: 4 }}>
              {[
                { key: 'grid', icon: 'grid-on', label: 'Grid', active: camGrid, onPress: () => setCamGrid(v => !v) },
                { key: 'golden', icon: 'filter-center-focus', label: 'Golden', active: camGolden, onPress: () => setCamGolden(v => !v) },
                { key: 'spiral', icon: 'filter-tilt-shift', label: 'Spiral', active: camSpiral, onPress: () => setCamSpiral(v => !v) },
              ].map(g => (
                <TouchableOpacity key={g.key} onPress={g.onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 5, borderRadius: 16, backgroundColor: g.active ? 'rgba(221,198,22,0.18)' : 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: g.active ? THEME.primary + '60' : 'rgba(255,255,255,0.12)' }}>
                  <MaterialIcons name={g.icon as any} size={13} color={g.active ? THEME.primary : '#ccc'} />
                  <Text style={{ color: g.active ? THEME.primary : '#ccc', fontSize: 10, fontWeight: '600', marginLeft: 4 }}>{g.label}</Text>
                </TouchableOpacity>
              ))}
              {camSpiral && (
                <TouchableOpacity onPress={() => setCamSpiralRotation(r => (r + 90) % 360)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: 'rgba(221,198,22,0.1)', borderWidth: 1, borderColor: THEME.primary + '40' }}>
                  <MaterialIcons name="rotate-right" size={13} color={THEME.primary} />
                  <Text style={{ color: THEME.primary, fontSize: 10, fontWeight: '600', marginLeft: 3 }}>{camSpiralRotation}�</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Zoom strip � always visible */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5, paddingVertical: 8 }}>
              {([
                { label: '1�', value: 0 },
                { label: '2�', value: 0.143 },
                { label: '3�', value: 0.286 },
                { label: '5�', value: 0.571 },
                { label: '8�', value: 1 },
              ] as const).map(z => {
                const isActive = Math.abs(camZoom - z.value) < 0.05;
                return (
                  <TouchableOpacity key={z.label} onPress={() => setCamZoom(z.value)} style={{ paddingHorizontal: 15, paddingVertical: 7, borderRadius: 20, backgroundColor: isActive ? THEME.primary : 'rgba(255,255,255,0.1)', borderWidth: isActive ? 0 : 1, borderColor: 'rgba(255,255,255,0.15)' }}>
                    <Text style={{ color: isActive ? THEME.bgBase : '#fff', fontSize: 13, fontWeight: '800' }}>{z.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Shutter row: gallery | shutter | ratio */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', paddingTop: 4, paddingBottom: 6, paddingHorizontal: 32 }}>
              {/* Gallery */}
              <TouchableOpacity onPress={launchPicker} style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                <MaterialIcons name="photo-library" size={24} color="#fff" />
              </TouchableOpacity>

              {/* Shutter button */}
              <TouchableOpacity onPress={takePictureWithTimer} disabled={cameraSaving || camTimerCountdown > 0} style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: 'rgba(255,255,255,0.85)', backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: cameraSaving ? 'rgba(221,198,22,0.6)' : '#fff', opacity: (cameraSaving || camTimerCountdown > 0) ? 0.5 : 1 }} />
              </TouchableOpacity>

              {/* Aspect ratio cycle */}
              <TouchableOpacity onPress={() => setCamRatio(r => r === 'full' ? '4:3' : r === '4:3' ? '1:1' : r === '1:1' ? '16:9' : 'full')} style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 14 }}>{camRatio === 'full' ? 'FULL' : camRatio}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Captured photo preview � Retake / Use Photo ── */}
          {camCapturedPhoto && (
            <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 50, justifyContent: 'center', alignItems: 'center' }}>
              <Image source={{ uri: camCapturedPhoto.uri }} style={{ width: width, height: height * 0.78, resizeMode: 'contain' }} />
              <View style={{ position: 'absolute', bottom: safeBottom + 28, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 16, paddingHorizontal: 36 }}>
                <TouchableOpacity onPress={() => setCamCapturedPhoto(null)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', paddingVertical: 16, borderRadius: 18, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }}>
                  <MaterialIcons name="replay" size={22} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={sendCapturedToEditor} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.primary, paddingVertical: 16, borderRadius: 18, gap: 8 }}>
                  <MaterialIcons name="check" size={22} color={THEME.bgBase} />
                  <Text style={{ color: THEME.bgBase, fontSize: 15, fontWeight: '700' }}>Use Photo</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
        );
      })() : appState === 'splash' || appState === 'home' || !bgImage ? (
        <LinearGradient colors={splashGradient.colors as any} start={splashGradient.start} end={splashGradient.end} style={[styles.splashContent, { paddingTop: safeTop + 20 }]}>
          <Image source={{ uri: SPLASH_LOGO_URL }} style={styles.mainLogoImage} resizeMode="contain" />
          <Text style={styles.splashTitle}>{splashText.title}</Text>
          {appState === 'splash' ? ( <ActivityIndicator size="large" color={THEME.primary} style={{ marginVertical: 30, height: 56 }} /> ) : (
            <View style={{ marginVertical: 30, gap: 12, alignItems: 'center' }}>
              <TouchableOpacity style={styles.primaryBtn} onPress={launchPicker}><MaterialIcons name="image" size={20} color={THEME.bgBase} style={{marginRight: 10}} /><Text style={styles.primaryBtnText}>{splashText.buttonText}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: THEME.primaryContainer, borderWidth: 1, borderColor: THEME.primary }]} onPress={launchCamera}><MaterialIcons name="camera-alt" size={20} color={THEME.primary} style={{marginRight: 10}} /><Text style={[styles.primaryBtnText, { color: THEME.primary }]}>Open Camera</Text></TouchableOpacity>
            </View>
          )}
          <View style={[styles.splashFooter, { bottom: safeBottom + 20 }]}>
            <Text style={styles.splashSubtitle}>{splashText.subtitle}</Text>
            <Text style={styles.splashVersion}>ACCHU KANNADA v{(Constants.manifest as any)?.version || (Constants as any).expoConfig?.version || '1.0.0'}</Text>
            <Text style={styles.splashCopyright}>{splashText.copyright}</Text>
          </View>
        </LinearGradient>
      ) : (
        <>
          <View style={[styles.headerSafeArea, { paddingTop: safeTop }]}>
            <View style={[styles.header, { height: headerH }]}>
              {activeTab === 'crop' ? ( 
                <>
                  <TouchableOpacity onPress={cancelCrop} style={styles.iconBtn}>
                    <MaterialIcons name="arrow-back" size={22} color={THEME.textMain} />
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="crop" size={20} color={THEME.textMain} />
                    <Text style={{ color: THEME.textMain, fontSize: 15, fontWeight: '700' }}>Crop</Text>
                  </View>
                  <TouchableOpacity onPress={() => { setCropRotation(0); setFineRotation(0); setCropFlipH(false); setCropFlipV(false); setActiveRatio(null); bgTransformRef.current = { x: 0, y: 0, scale: 1, baseScale: 1 }; }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6 }}>
                    <MaterialIcons name="refresh" size={20} color={THEME.textMuted} />
                  </TouchableOpacity>
                </> 
              ) : ( 
                <>
                  <TouchableOpacity onPress={() => { setAppState('home'); setSelectedId(null); setActiveTab('crop'); }} style={styles.iconBtn}><MaterialIcons name="arrow-back" size={22} color={THEME.textMain} /></TouchableOpacity>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {(selectedId || selectedGroupId) && <TouchableOpacity onPress={deleteElement} style={{ padding: 10 }}><MaterialIcons name="delete" size={20} color={THEME.error} /></TouchableOpacity>}
                    <TouchableOpacity onPress={undo} disabled={past.length === 0} style={{ padding: 10, opacity: past.length === 0 ? 0.3 : 1 }}><MaterialIcons name="undo" size={20} color={THEME.textMain} /></TouchableOpacity>
                    <TouchableOpacity onPress={redo} disabled={future.length === 0} style={{ padding: 10, opacity: future.length === 0 ? 0.3 : 1 }}><MaterialIcons name="redo" size={20} color={THEME.textMain} /></TouchableOpacity>
                    <TouchableOpacity onPressIn={() => setShowOriginal(true)} onPressOut={() => setShowOriginal(false)} style={{ padding: 10, opacity: (activeFilter.id !== 'none' || Object.values(imgAdj).some((v: any) => v !== 0)) ? 1 : 0.3 }}><MaterialIcons name="compare" size={20} color={showOriginal ? THEME.primary : THEME.textMain} /></TouchableOpacity>
                    <TouchableOpacity style={{ padding: 10 }} onPress={prepareExport}><MaterialIcons name="file-download" size={22} color={THEME.primary} /></TouchableOpacity>
                    {/* ── Pro pill button (outlined brand) ── */}
                    <TouchableOpacity
                      onPress={() => setCrownModalVisible(true)}
                      activeOpacity={0.85}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 6,
                        backgroundColor: 'transparent',
                        paddingVertical: 5, paddingHorizontal: 12,
                        borderRadius: 22, marginLeft: 6,
                        borderWidth: 1.8, borderColor: THEME.primary,
                      }}
                    >
                      <MaterialCommunityIcons name="crown" size={16} color={THEME.primary} />
                      <Text style={{ color: THEME.primary, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 }}>Pro</Text>
                    </TouchableOpacity>
                  </View>
                </> 
              )}
            </View>
          </View>
          
          <View style={styles.canvasContainer}>
            <ViewShot ref={viewShotRef} options={{ format: exportFormat === 'pdf' ? 'png' : exportFormat, quality: exportFormat === 'pdf' ? 1 : exportQuality }} style={[styles.viewShot, { width: renderedW, height: renderedH, isolation: 'isolate' } as any]}>
              <DraggableBackground src={bgImage} imgDim={imgDim} canvasW={renderedW} canvasH={renderedH} isLocked={activeTab !== 'crop'} forceColorMatrix={forceColorMatrix} glCaptureUri={glCaptureUri} glEditorRefProp={glEditorRef} filterMatrix={showOriginal ? IDENTITY_MATRIX : activeFilter.matrix} filterStrength={showOriginal ? 0 : filterStrength} filterPreviewColor={showOriginal ? 'transparent' : activeFilter.previewColor} brightness={showOriginal ? 0 : imgAdj.brightness} contrast={showOriginal ? 0 : imgAdj.contrast} highlights={showOriginal ? 0 : imgAdj.highlights} shadows={showOriginal ? 0 : imgAdj.shadows} temp={showOriginal ? 0 : imgAdj.temp} tint={showOriginal ? 0 : imgAdj.tint} fade={showOriginal ? 0 : imgAdj.fade} dehaze={showOriginal ? 0 : imgAdj.dehaze} saturation={showOriginal ? 0 : imgAdj.saturation} vibrance={showOriginal ? 0 : imgAdj.vibrance} clarity={showOriginal ? 0 : imgAdj.clarity} sharpness={showOriginal ? 0 : imgAdj.sharpness} hslValues={showOriginal ? DEFAULT_HSL : hslValues} curveR={showOriginal ? IDENTITY_CURVE_17 : curveR} curveG={showOriginal ? IDENTITY_CURVE_17 : curveG} curveB={showOriginal ? IDENTITY_CURVE_17 : curveB} curveMaster={showOriginal ? IDENTITY_CURVE_17 : curveMaster} extraTransform={activeTab === 'crop' && (cropRotation !== 0 || cropFlipH || cropFlipV) ? (() => {
                  const t: any[] = [];
                  // Flips
                  if (cropFlipH) t.push({ scaleX: -1 });
                  if (cropFlipV) t.push({ scaleY: -1 });
                  // Auto-scale to prevent crop voids during rotation (Lightroom-style)
                  if (cropRotation !== 0) {
                    const totalDeg = cropRotation;
                    const fineAngleDeg = ((totalDeg % 90) + 90) % 90;
                    const effAngle = fineAngleDeg > 45 ? 90 - fineAngleDeg : fineAngleDeg;
                    const theta = (effAngle * Math.PI) / 180;
                    if (theta > 0.001) {
                      const aspect = renderedW / renderedH;
                      const r = Math.max(aspect, 1 / aspect);
                      const autoScale = Math.cos(theta) + Math.sin(theta) * r;
                      if (autoScale > 1.001) t.push({ scale: autoScale });
                    }
                    t.push({ rotate: `${totalDeg}deg` });
                  }
                  return t;
                })() : undefined} onTransformChange={(t: any) => { bgTransformRef.current = t; }} />
              {activeTab !== 'crop' && ( <TouchableWithoutFeedback onPress={() => { setSelectedId(null); setSelectedGroupId(null); setGroupEditMode(false); }}><View style={StyleSheet.absoluteFill} /></TouchableWithoutFeedback> )}
              {/* Behind-subject elements (rendered below the foreground cutout) */}
              {activeTab !== 'crop' && !showOriginal && elements.filter(el => el.behindSubject).map((el, idx) => {
                const isGrouped = !!el.groupId;
                const isGroupSelected = isGrouped && selectedGroupId === el.groupId;
                const showIndividual = !isGrouped || (isGroupSelected && groupEditMode);
                const isElSelected = showIndividual && selectedId === el.id;
                // In group mode (not edit), hide individual bounding box but still render the element
                if (isGrouped && isGroupSelected && !groupEditMode) {
                  return (
                    <View key={`behind-${el.id}`} style={[StyleSheet.absoluteFill, { zIndex: 100 + idx }]} pointerEvents="none">
                      <DraggableItem item={el} isSelected={false} canvasW={renderedW} canvasH={renderedH} fontList={fontList} onTap={() => {}} onDoubleTap={() => {}} onDragStart={() => {}} onDragMove={() => {}} onDragEnd={() => {}} onWidthChangeStart={() => {}} onWidthChange={() => {}} onWidthChangeEnd={() => {}} />
                    </View>
                  );
                }
                return (
                <View key={`behind-${el.id}`} style={[StyleSheet.absoluteFill, { zIndex: 100 + idx }]} pointerEvents="box-none">
                <DraggableItem
                  item={el}
                  isSelected={isElSelected}
                  canvasW={renderedW}
                  canvasH={renderedH}
                  fontList={fontList}
                  onTap={(id: string) => {
                    if (isGrouped && !isGroupSelected) {
                      setSelectedGroupId(el.groupId!); setSelectedId(null); setGroupEditMode(false); setActiveTab('text');
                    } else if (isGrouped && isGroupSelected && groupEditMode) {
                      setSelectedId(id); setActiveTab(el.type === 'image' ? 'stickers' : 'text');
                    } else {
                      setSelectedId(id); setActiveTab(el.type === 'image' ? 'stickers' : 'text');
                    }
                  }}
                  onDoubleTap={() => {
                    if (isGrouped && isGroupSelected && !groupEditMode) {
                      setGroupEditMode(true); setSelectedId(el.id); setActiveTab('text');
                    } else {
                      setSelectedId(el.id); setCurrentText(el.content || ''); setIsTyping(true);
                    }
                  }}
                  onDragStart={() => {}}
                  onDragMove={() => {}}
                  onDragEnd={(id: string, y: number, tx: number, ty: number, tscale: number, trot: number) => {
                    commitHistory(prev => {
                      const target = prev.find(e => e.id === id);
                      if (!target || (target.x === tx && target.y === ty && target.scale === tscale && target.rotation === trot)) return prev;
                      const dx = tx - target.x; const dy = ty - target.y;
                      const ds = tscale / (target.scale || 1); const dr = trot - (target.rotation || 0);
                      if (target.groupId && !groupEditMode) {
                        return prev.map(e => e.groupId === target.groupId ? { ...e, x: e.id === id ? tx : e.x + dx, y: e.id === id ? ty : e.y + dy, scale: e.id === id ? tscale : (e.scale || 1) * ds, rotation: e.id === id ? trot : (e.rotation || 0) + dr } : e);
                      }
                      return prev.map(e => e.id === id ? { ...e, x: tx, y: ty, scale: tscale, rotation: trot } : e);
                    });
                  }}
                  onWidthChangeStart={() => handleSliderStart()}
                  onWidthChange={(id: string, newWidth: number) => updateSelectedStyle('width', newWidth)}
                  onWidthChangeEnd={() => handleSliderComplete()}
                />
                </View>
                );
              })}
              {/* Subject foreground cutout overlay — GL shader with alpha: applies all filters+adjustments to the cutout PNG */}
              {activeTab !== 'crop' && !showOriginal && subjectCutoutUri && elements.some(el => el.behindSubject) && (() => {
                // Photoshop-style "behind" depth: opacity of the foreground cutout overlay follows the max
                // behindDepth among all behind-subject elements (default 1 when toggle is on but no depth set).
                const behindEls = elements.filter(e => e.behindSubject);
                const depth = behindEls.length === 0 ? 1 : Math.max(...behindEls.map(e => (typeof e.behindDepth === 'number' ? e.behindDepth : 1)));
                return (
                  <View style={[StyleSheet.absoluteFill, { zIndex: 500, opacity: depth }]} pointerEvents="none">
                    <GLImageEditor
                      src={subjectCutoutUri}
                      width={renderedW}
                      height={renderedH}
                      uniforms={cutoutGlUniforms}
                      transparent={true}
                    />
                  </View>
                );
              })()}
              {/* Normal elements (rendered above the foreground cutout) */}
              {activeTab !== 'crop' && !showOriginal && elements.filter(el => !el.behindSubject).map((el, idx) => {
                const isGrouped = !!el.groupId;
                const isGroupSelected = isGrouped && selectedGroupId === el.groupId;
                const showIndividual = !isGrouped || (isGroupSelected && groupEditMode);
                const isElSelected = showIndividual && selectedId === el.id;
                // In group mode (not edit), render element without bounding box (group box handles interaction)
                // Apply live drag offset so elements move in sync with bounding box
                if (isGrouped && isGroupSelected && !groupEditMode) {
                  const gd = groupDragRef.current;
                  const draggedItem = (gd.dx !== 0 || gd.dy !== 0) ? { ...el, x: el.x + gd.dx, y: el.y + gd.dy } : el;
                  return (
                    <View key={`normal-${el.id}`} style={[StyleSheet.absoluteFill, { zIndex: 600 + idx }]} pointerEvents="none">
                      <DraggableItem item={draggedItem} isSelected={false} canvasW={renderedW} canvasH={renderedH} fontList={fontList} onTap={() => {}} onDoubleTap={() => {}} onDragStart={() => {}} onDragMove={() => {}} onDragEnd={() => {}} onWidthChangeStart={() => {}} onWidthChange={() => {}} onWidthChangeEnd={() => {}} />
                    </View>
                  );
                }
                return (
                <View key={`normal-${el.id}`} style={[StyleSheet.absoluteFill, { zIndex: 600 + idx }]} pointerEvents="box-none">
                <DraggableItem
                  item={el}
                  isSelected={isElSelected}
                  canvasW={renderedW}
                  canvasH={renderedH}
                  fontList={fontList}
                  onTap={(id: string) => {
                    if (isGrouped && !isGroupSelected) {
                      setSelectedGroupId(el.groupId!); setSelectedId(null); setGroupEditMode(false); setActiveTab('text');
                    } else if (isGrouped && isGroupSelected && groupEditMode) {
                      setSelectedId(id); setActiveTab(el.type === 'image' ? 'stickers' : 'text');
                    } else {
                      setSelectedId(id); setActiveTab(el.type === 'image' ? 'stickers' : 'text');
                    }
                  }}
                  onDoubleTap={() => {
                    if (isGrouped && isGroupSelected && !groupEditMode) {
                      setGroupEditMode(true); setSelectedId(el.id); setActiveTab('text');
                    } else {
                      setSelectedId(el.id); setCurrentText(el.content || ''); setIsTyping(true);
                    }
                  }}
                  onDragStart={() => {}}
                  onDragMove={() => {}}
                  onDragEnd={(id: string, y: number, tx: number, ty: number, tscale: number, trot: number) => {
                    commitHistory(prev => {
                      const target = prev.find(e => e.id === id);
                      if (!target || (target.x === tx && target.y === ty && target.scale === tscale && target.rotation === trot)) return prev;
                      const dx = tx - target.x; const dy = ty - target.y;
                      const ds = tscale / (target.scale || 1); const dr = trot - (target.rotation || 0);
                      if (target.groupId && !groupEditMode) {
                        return prev.map(e => e.groupId === target.groupId ? { ...e, x: e.id === id ? tx : e.x + dx, y: e.id === id ? ty : e.y + dy, scale: e.id === id ? tscale : (e.scale || 1) * ds, rotation: e.id === id ? trot : (e.rotation || 0) + dr } : e);
                      }
                      return prev.map(e => e.id === id ? { ...e, x: tx, y: ty, scale: tscale, rotation: trot } : e);
                    });
                  }}
                  onWidthChangeStart={() => handleSliderStart()}
                  onWidthChange={(id: string, newWidth: number) => updateSelectedStyle('width', newWidth)}
                  onWidthChangeEnd={() => handleSliderComplete()}
                />
                </View>
                );
              })}
              {/* Group bounding boxes — visible in both group-selected and edit mode */}
              {activeTab !== 'crop' && !showOriginal && selectedGroupId && (() => {
                return (
                  <GroupBoundingBox
                    groupId={selectedGroupId}
                    elements={elements}
                    canvasW={renderedW}
                    canvasH={renderedH}
                    isSelected={!groupEditMode}
                    isEditMode={groupEditMode}
                    onTap={() => { /* single tap on group box: no action, group stays selected */ }}
                    onDoubleTap={() => { setGroupEditMode(true); const firstEl = elements.find(e => e.groupId === selectedGroupId); if (firstEl) { setSelectedId(firstEl.id); setActiveTab('text'); } }}
                    onDragStart={() => {}}
                    onDragMove={(dx: number, dy: number, ds: number, dr: number) => {
                      groupDragRef.current = { dx, dy, ds, dr };
                      setGroupDragTick(n => n + 1);
                    }}
                    onDragEnd={(dx: number, dy: number, ds: number, dr: number) => {
                      groupDragRef.current = { dx: 0, dy: 0, ds: 1, dr: 0 };
                      commitHistory(prev => prev.map(e => e.groupId === selectedGroupId ? { ...e, x: e.x + dx, y: e.y + dy } : e));
                    }}
                  />
                );
              })()}
              {activeTab !== 'crop' && !isPro && <Image source={{ uri: SPLASH_LOGO_URL }} style={{ position: 'absolute', bottom: 5, right: 0, width: 76, height: 34, opacity: 0.25, zIndex: 999 }} resizeMode="contain" />}
            </ViewShot>
            {activeTab === 'crop' && (
              <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]} pointerEvents="none">
                <View style={{ width: renderedW, height: renderedH }}>
                  {/* Rule of thirds grid */}
                  <View style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
                  <View style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
                  <View style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
                  <View style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)' }} />
                  {/* Corner brackets */}
                  <View style={{ position: 'absolute', top: -1, left: -1, width: 20, height: 20, borderTopWidth: 3, borderLeftWidth: 3, borderColor: '#fff' }} />
                  <View style={{ position: 'absolute', top: -1, right: -1, width: 20, height: 20, borderTopWidth: 3, borderRightWidth: 3, borderColor: '#fff' }} />
                  <View style={{ position: 'absolute', bottom: -1, left: -1, width: 20, height: 20, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: '#fff' }} />
                  <View style={{ position: 'absolute', bottom: -1, right: -1, width: 20, height: 20, borderBottomWidth: 3, borderRightWidth: 3, borderColor: '#fff' }} />
                  {/* Edge midpoint handles */}
                  <View style={{ position: 'absolute', top: -2, left: '50%', marginLeft: -12, width: 24, height: 3, borderRadius: 2, backgroundColor: '#fff' }} />
                  <View style={{ position: 'absolute', bottom: -2, left: '50%', marginLeft: -12, width: 24, height: 3, borderRadius: 2, backgroundColor: '#fff' }} />
                  <View style={{ position: 'absolute', left: -2, top: '50%', marginTop: -12, width: 3, height: 24, borderRadius: 2, backgroundColor: '#fff' }} />
                  <View style={{ position: 'absolute', right: -2, top: '50%', marginTop: -12, width: 3, height: 24, borderRadius: 2, backgroundColor: '#fff' }} />
                  {/* Border */}
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' }} />
                  {/* Golden ratio Fibonacci spiral */}
                  {showSpiral && (
                    <Svg style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${spiralRotation}deg` }, { scaleX: spiralFlipH ? -1 : 1 }, { scaleY: spiralFlipV ? -1 : 1 }] }]} viewBox={`0 0 ${renderedW} ${renderedH}`}>
                      {(() => {
                        const w = renderedW, h = renderedH;
                        const phi = 1.618033988749895;
                        const b = Math.log(phi) / (Math.PI / 2);
                        const spCx = w * 0.382;
                        const spCy = h * 0.618;
                        const maxR = Math.max(w, h) * 0.78;
                        const quarters = 7;
                        const maxTheta = quarters * (Math.PI / 2);
                        const a = maxR / Math.exp(b * maxTheta);
                        const N = 180;
                        let d = '';
                        for (let i = 0; i <= N; i++) {
                          const theta = (i / N) * maxTheta;
                          const r = a * Math.exp(b * theta);
                          const angle = -theta + Math.PI;
                          const x = spCx + r * Math.cos(angle);
                          const y = spCy + r * Math.sin(angle);
                          d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
                        }
                        return <Path d={d} stroke="rgba(200,200,200,0.55)" strokeWidth={1.5} fill="none" />;
                      })()}
                    </Svg>
                  )}
                </View>
              </View>
            )}
            {showOriginal && (
              <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 12 }]} pointerEvents="none">
                <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 12 }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 }}>ORIGINAL</Text>
                </View>
              </View>
            )}
            {/* Pro features active banner — overlays image at bottom, does not reflow layout */}
            {hasProFeaturesInUse && activeTab !== 'crop' && (
              <TouchableOpacity
                onPress={() => setPaywallVisible(true)}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 7, backgroundColor: 'rgba(221,198,22,0.18)', borderTopWidth: 1, borderColor: 'rgba(221,198,22,0.35)' }}
              >
                <MaterialIcons name="auto-awesome" size={15} color={THEME.primary} />
                <Text style={{ color: THEME.primary, fontSize: 12, fontWeight: '700' }}>Pro ಫೀಚರ್‌ಗಳನ್ನು ಬಳಸಲಾಗುತ್ತಿದೆ</Text>
                <View style={{ backgroundColor: THEME.primary, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 }}>
                  <Text style={{ color: '#000', fontSize: 10, fontWeight: '800' }}>ಅಪ್‌ಗ್ರೇಡ್</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.bottomPanelWrapper}>
            <View style={[styles.bottomArea, { paddingBottom: safeBottom }]}>
              <View style={styles.dragHandle} />
              {activeTab === 'crop' ? (
                <View style={{ paddingTop: 2 }}>
                  {/* ── Rotation Ruler Dial ── */}
                  <View style={{ alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ color: fineRotation !== 0 ? THEME.primary : THEME.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>{fineRotation > 0 ? '+' : ''}{fineRotation.toFixed(1)}°</Text>
                    <View style={{ height: 34, overflow: 'hidden', width: '100%' }}>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ paddingHorizontal: (width - 20) / 2, alignItems: 'center' }}
                        snapToInterval={4}
                        decelerationRate="fast"
                        onScroll={(e) => {
                          const offsetX = e.nativeEvent.contentOffset.x;
                          const centerOffset = offsetX - ((45 * 4));
                          const degree = Math.max(-45, Math.min(45, centerOffset / 4));
                          setFineRotation(Math.round(degree * 10) / 10);
                          setCropRotation(degree);
                        }}
                        scrollEventThrottle={16}
                        contentOffset={{ x: 45 * 4, y: 0 }}
                      >
                        {Array.from({ length: 91 }, (_, i) => {
                          const deg = i - 45;
                          const isMajor = deg % 10 === 0;
                          const isMid = deg % 5 === 0;
                          return (
                            <View key={i} style={{ width: 4, alignItems: 'center', justifyContent: 'flex-end', height: 34 }}>
                              <View style={{ width: isMajor ? 2 : 1, height: isMajor ? 20 : isMid ? 14 : 8, backgroundColor: deg === 0 ? THEME.primary : isMajor ? 'rgba(255,255,255,0.6)' : isMid ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)', borderRadius: 1 }} />
                              {isMajor && <Text style={{ color: THEME.textMuted, fontSize: 8, marginTop: 1 }}>{deg}</Text>}
                            </View>
                          );
                        })}
                      </ScrollView>
                      {/* Center indicator line */}
                      <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, backgroundColor: THEME.primary, marginLeft: -1, borderRadius: 1 }} pointerEvents="none" />
                    </View>
                  </View>

                  {/* ── Transform Tools Row ── */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 8, paddingHorizontal: 16 }}>
                    <TouchableOpacity onPress={() => setCropRotation(r => r - 90)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 10 }}>
                      <MaterialIcons name="rotate-left" size={18} color={THEME.textMain} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setCropRotation(r => r + 90)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 10 }}>
                      <MaterialIcons name="rotate-right" size={18} color={THEME.textMain} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setCropFlipH(v => !v)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, backgroundColor: cropFlipH ? 'rgba(221,198,22,0.15)' : THEME.bgSurfaceHigh, borderRadius: 10 }}>
                      <MaterialIcons name="flip" size={18} color={cropFlipH ? THEME.primary : THEME.textMain} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setCropFlipV(v => !v)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, backgroundColor: cropFlipV ? 'rgba(221,198,22,0.15)' : THEME.bgSurfaceHigh, borderRadius: 10, transform: [{ rotate: '90deg' }] }}>
                      <MaterialIcons name="flip" size={18} color={cropFlipV ? THEME.primary : THEME.textMain} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { if (!isPro) { requirePro(); return; } setShowSpiral(v => !v); }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, backgroundColor: showSpiral ? 'rgba(221,198,22,0.15)' : THEME.bgSurfaceHigh, borderRadius: 10 }}>
                      <MaterialIcons name="filter-tilt-shift" size={18} color={showSpiral ? THEME.primary : THEME.textMain} />
                    </TouchableOpacity>
                  </View>

                  {/* ── Aspect Ratio Icon Buttons ── */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 12, alignItems: 'center', paddingBottom: 6 }}>
                    {([
                      { key: 'original', label: 'Original', w: 22, h: 22, useImgIcon: true },
                      { key: 'free',     label: 'Free',     w: 22, h: 16 },
                      { key: '1:1',      label: 'Square',   w: 20, h: 20, ratio: [1, 1] as [number, number] },
                      { key: '3:4',      label: '3:4',      w: 16, h: 22, ratio: [3, 4] as [number, number] },
                      { key: '4:3',      label: '4:3',      w: 22, h: 16, ratio: [4, 3] as [number, number] },
                      { key: '3:2',      label: '3:2',      w: 22, h: 15, ratio: [3, 2] as [number, number] },
                      { key: '2:3',      label: '2:3',      w: 15, h: 22, ratio: [2, 3] as [number, number] },
                      { key: '16:9',     label: '16:9',     w: 24, h: 14, ratio: [16, 9] as [number, number] },
                      { key: '9:16',     label: '9:16',     w: 14, h: 24, ratio: [9, 16] as [number, number] },
                    ] as const).map((opt: any) => {
                      let isActive = false;
                      if (opt.key === 'original') isActive = activeRatio !== null && activeRatio[0] === imgDim.w && activeRatio[1] === imgDim.h;
                      else if (opt.key === 'free') isActive = activeRatio === null;
                      else if (opt.ratio) isActive = activeRatio?.[0] === opt.ratio[0] && activeRatio?.[1] === opt.ratio[1];
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          onPress={() => {
                            if (opt.key === 'original') setActiveRatio([imgDim.w, imgDim.h]);
                            else if (opt.key === 'free') setActiveRatio(null);
                            else if (opt.ratio) setActiveRatio([opt.ratio[0], opt.ratio[1]]);
                          }}
                          style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}
                        >
                          <View
                            style={{
                              width: 44, height: 44, borderRadius: 10,
                              borderWidth: isActive ? 2 : 1.5,
                              borderColor: isActive ? THEME.primary : 'rgba(255,255,255,0.35)',
                              backgroundColor: isActive ? 'rgba(221,198,22,0.12)' : 'transparent',
                              alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            {opt.useImgIcon ? (
                              <MaterialIcons name="image" size={20} color={isActive ? THEME.primary : 'rgba(255,255,255,0.75)'} />
                            ) : (
                              <View style={{
                                width: opt.w, height: opt.h,
                                borderWidth: 1.5,
                                borderColor: isActive ? THEME.primary : 'rgba(255,255,255,0.75)',
                                borderRadius: 2,
                              }} />
                            )}
                          </View>
                          <Text style={{ color: isActive ? THEME.primary : THEME.textMuted, fontSize: 10, fontWeight: '600', marginTop: 4 }}>{opt.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* ── Yellow Action Bar (Cancel / Crop image / Apply) ── */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: THEME.primary, borderRadius: 28, marginHorizontal: 14, marginTop: 8, paddingVertical: 10, paddingHorizontal: 16, shadowColor: THEME.primary, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
                    <TouchableOpacity onPress={cancelCrop} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.15)', justifyContent: 'center', alignItems: 'center' }}>
                      <MaterialIcons name="close" size={22} color="#0a0a0c" />
                    </TouchableOpacity>
                    <Text style={{ color: '#0a0a0c', fontSize: 15, fontWeight: '800', letterSpacing: 0.2 }}>Crop image</Text>
                    <TouchableOpacity onPress={applyCrop} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#0a0a0c', justifyContent: 'center', alignItems: 'center' }}>
                      <MaterialIcons name="check" size={22} color={THEME.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.segmentedControl}>
                    {activeTextEl ? (<>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setTextSubTab('fonts')}><View style={[styles.navIndicator, textSubTab === 'fonts' && styles.navIndicatorActive]}><MaterialIcons name="text-fields" size={20} color={textSubTab === 'fonts' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, textSubTab === 'fonts' && styles.segmentTextActive]}>Fonts</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setTextSubTab('style')}><View style={[styles.navIndicator, textSubTab === 'style' && styles.navIndicatorActive]}><MaterialIcons name="tune" size={20} color={textSubTab === 'style' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, textSubTab === 'style' && styles.segmentTextActive]}>Style</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setTextSubTab('color')}><View style={[styles.navIndicator, textSubTab === 'color' && styles.navIndicatorActive]}><MaterialIcons name="palette" size={20} color={textSubTab === 'color' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, textSubTab === 'color' && styles.segmentTextActive]}>Colors</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => { setSelectedId(null); setActiveTab('filters'); }}><View style={[styles.navIndicator]}><MaterialIcons name="close" size={20} color={THEME.textMuted} /></View><Text style={[styles.segmentText]}>Done</Text></TouchableOpacity>
                    </>) : (<>
                      {([
                        { id: 'crop' as const, icon: 'crop', label: 'Crop' },
                        { id: 'filters' as const, icon: 'style', label: 'Filters' },
                        { id: 'adjust' as const, icon: 'tune', label: 'Adjust' },
                        { id: 'pro' as const, icon: 'auto-awesome', label: 'Pro' },
                        { id: 'text' as const, icon: 'format-shapes', label: 'Text' },
                        { id: 'stickers' as const, icon: 'extension', label: 'Stickers' },
                      ] as const).map(tab => (
                        <TouchableOpacity key={tab.id} style={styles.segmentBtn} onPress={() => { setActiveTab(tab.id); if (tab.id !== 'text' && tab.id !== 'stickers') setSelectedId(null); showGuideIfNeeded(tab.id); }}>
                          <View style={[styles.navIndicator, activeTab === tab.id && styles.navIndicatorActive]}>
                            <MaterialIcons name={tab.icon as any} size={20} color={activeTab === tab.id ? THEME.primary : THEME.textMuted} />
                          </View>
                          <Text style={[styles.segmentText, activeTab === tab.id && styles.segmentTextActive]}>{tab.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </>)}
                  </View>
                  
                  <View style={[styles.tabContent, { height: bottomPanelH - 56 }]}>
                    {activeTab === 'filters' && (
                      <View style={{ flex: 1 }}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 32, marginBottom: 6 }} contentContainerStyle={{ paddingRight: 12, alignItems: 'center' }}>
                              {allFilterCategories.map(cat => (
                                <TouchableOpacity key={cat.id} onPress={() => setFilterCategoryId(cat.id)} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: filterCategoryId === cat.id ? THEME.primary : THEME.bgSurfaceHigh, marginRight: 8 }}>
                                  <Text style={{ color: filterCategoryId === cat.id ? THEME.bgBase : THEME.textMuted, fontSize: 11, fontWeight: '600' }}>{cat.label}</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                            <View style={{ flex: 1, justifyContent: 'center' }}>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
                                {allFilters.filter(f => filterCategoryId === 'all' || f.id === 'none' || f.id.startsWith(filterCategoryId) || (filterCategoryId === 'filmstock' && f.id.startsWith('fs_')) || (filterCategoryId === 'pro_cloud' && allPremiumFilterIds.has(f.id) && !f.id.startsWith('pro_'))).map(f => {
                                  const isProFilter = f.id !== 'none' && allPremiumFilterIds.has(f.id);
                                  const locked = isProFilter && !isPro;
                                  return (
                                  <TouchableOpacity key={f.id} onPress={() => { setActiveFilter(f); setFilterStrength(f.defaultStrength); }} style={{ alignItems: 'center', marginRight: 8, width: 56 }}>
                                     <View style={[{ width: 52, borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: activeFilter.id === f.id ? THEME.primary : 'transparent', backgroundColor: '#fff' }]}>
                                       <View style={{ width: '100%', aspectRatio: 1, backgroundColor: f.id === 'none' ? THEME.bgSurfaceHigh : '#000' }}>
                                         {bgImage ? <Image source={{ uri: bgImage }} style={{ width: '100%', height: '100%', opacity: f.id === 'none' ? 1 : 0.85 }} resizeMode="cover" /> : null}
                                         {f.id !== 'none' && <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: f.previewColor, opacity: 0.45 }} />}
                                         {locked && <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' }}><MaterialIcons name="lock" size={16} color="#fff" /></View>}
                                       </View>
                                       <View style={{ paddingVertical: 3, alignItems: 'center', backgroundColor: '#fff' }}>
                                         <Text style={{ color: '#000', fontSize: 8, fontWeight: activeFilter.id === f.id ? '700' : '500' }} numberOfLines={1}>{f.label}</Text>
                                       </View>
                                     </View>
                                  </TouchableOpacity>
                                  );
                                })}
                              </ScrollView>
                            </View>
                            
                            {activeFilter.id !== 'none' && (
                              <View style={{ marginTop: 4, paddingTop: 2 }}>
                                <ProSlider icon="tune" label="Filter Strength" value={filterStrength * 100} min={0} max={100} step={1} displayValue={`${Math.round(filterStrength * 100)}%`} onChange={(v:number) => setFilterStrength(v / 100)} onScrollLock={setPanelScrollEnabled} />
                              </View>
                            )}
                      </View>
                    )}

                    {activeTab === 'adjust' && (() => {
                          const hasAnyAdj = ADJUST_TOOLS.some(t => imgAdj[t.key as keyof typeof imgAdj] !== 0);
                          const groups = ['Light', 'Color', 'Detail'] as const;
                          const groupIcons = { Light: 'wb-sunny', Color: 'palette', Detail: 'hdr-strong' } as const;
                          return (
                            <View style={{ flex: 1 }}>
                              <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={panelScrollEnabled} contentContainerStyle={{ paddingBottom: 16 }}>
                                {groups.map(g => {
                                  const isOpen = adjOpenSection === g.toLowerCase() as any;
                                  const tools = ADJUST_TOOLS.filter(t => t.group === g);
                                  const hasChanged = tools.some(t => imgAdj[t.key as keyof typeof imgAdj] !== 0);
                                  return (
                                    <View key={g} style={{ marginBottom: 4 }}>
                                      <TouchableOpacity onPress={() => setAdjOpenSection(isOpen ? '' as any : g.toLowerCase() as any)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, backgroundColor: isOpen ? THEME.bgSurfaceHigh : 'transparent', borderRadius: 10 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                          <MaterialIcons name={groupIcons[g] as any} size={16} color={hasChanged ? THEME.primary : THEME.textMuted} />
                                          <Text style={{ color: THEME.textMain, fontSize: 13, fontWeight: '600' }}>{g}</Text>
                                          {hasChanged && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: THEME.primary }} />}
                                        </View>
                                        <MaterialIcons name={isOpen ? 'expand-less' : 'expand-more'} size={20} color={THEME.textMuted} />
                                      </TouchableOpacity>
                                      {isOpen && (
                                        <View style={{ paddingHorizontal: 4, paddingTop: 4 }}>
                                          {tools.map(tool => {
                                            const val = imgAdj[tool.key as keyof typeof imgAdj];
                                            return (
                                              <ProSlider key={tool.key} icon={tool.icon} label={tool.label} value={val * 100} min={tool.min * 100} max={tool.max * 100} step={tool.step * 100}
                                                displayValue={`${Math.round(val * 100)}`}
                                                onChange={(v: number) => setAdj(tool.key as keyof typeof defaultAdj, v / 100)}
                                                onScrollLock={setPanelScrollEnabled}
                                              />
                                            );
                                          })}
                                        </View>
                                      )}
                                    </View>
                                  );
                                })}
                              </ScrollView>
                              {hasAnyAdj && (
                                <View style={{ flexDirection: 'row', justifyContent: 'center', paddingVertical: 6 }}>
                                  <TouchableOpacity onPress={() => setImgAdj(defaultAdj)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, backgroundColor: THEME.bgSurfaceHigh }}>
                                    <MaterialIcons name="refresh" size={14} color={THEME.textMuted} />
                                    <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', marginLeft: 4 }}>Reset All</Text>
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          );
                        })()}

                    {activeTab === 'pro' && (
                      <View style={{ flex: 1 }}>
                        {/* ── BACK HEADER (shown when inside a section) ── */}
                        {proActiveSection !== null && (
                          <TouchableOpacity onPress={() => setProActiveSection(null)}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingBottom: 10 }}>
                            <MaterialIcons name="arrow-back-ios" size={14} color={THEME.primary} />
                            <Text style={{ color: THEME.primary, fontSize: 12, fontWeight: '700' }}>
                              {proActiveSection === 'presets' ? 'My Presets' : proActiveSection === 'curves' ? 'Curves' : 'HSL'}
                            </Text>
                          </TouchableOpacity>
                        )}

                        {/* ── GRID (home view) ── */}
                        {proActiveSection === null && (
                          <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={panelScrollEnabled} contentContainerStyle={{ paddingBottom: 20 }}>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                              {[
                                { key: 'presets', icon: 'bookmark', label: 'My Presets', badge: userPresets.length > 0 ? `${userPresets.length}` : undefined, dot: false },
                                { key: 'curves', icon: 'show-chart', label: 'Curves', badge: undefined, dot: curveR.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01) || curveMaster.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01) },
                                { key: 'hsl', icon: 'palette', label: 'HSL', badge: undefined, dot: HSL_CHANNELS.some(ch => (hslValues[ch.key] || [0,0,0]).some((v: number) => v !== 0)) },
                              ].map((card) => (
                                <TouchableOpacity key={card.key} onPress={() => {
                                  if (card.key === 'curves') setShowCurveEditor(true);
                                  else setProActiveSection(card.key);
                                }}
                                  style={{ width: '47%', paddingVertical: 18, paddingHorizontal: 10, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 14, borderWidth: 1.5, borderColor: '#2a2b2e', alignItems: 'center', gap: 6 }}>
                                  <MaterialIcons name={card.icon as any} size={24} color={THEME.textMuted} />
                                  <Text style={{ color: THEME.textMain, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{card.label}</Text>
                                  {!isPro && (
                                    <View style={{ position: 'absolute', top: 8, left: 10, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' }}>
                                      <MaterialIcons name="lock" size={11} color={THEME.primary} />
                                    </View>
                                  )}
                                  <MaterialIcons name="chevron-right" size={14} color={THEME.textMuted} style={{ position: 'absolute', right: 10, top: '50%' }} />
                                  {card.badge !== undefined && <View style={{ position: 'absolute', top: 6, right: 8, backgroundColor: THEME.primary, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ color: THEME.bgBase, fontSize: 9, fontWeight: '700' }}>{card.badge}</Text></View>}
                                  {card.dot && <View style={{ position: 'absolute', top: 8, right: 10, width: 7, height: 7, borderRadius: 3.5, backgroundColor: THEME.primary }} />}
                                </TouchableOpacity>
                              ))}
                            </View>
                          </ScrollView>
                        )}

                        {/* ── SECTION DETAIL VIEW ── */}
                        {proActiveSection !== null && (
                          <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={panelScrollEnabled} contentContainerStyle={{ paddingBottom: 20 }}>

                            {/* MY PRESETS */}
                            {proActiveSection === 'presets' && (
                              <View style={{ backgroundColor: THEME.bgSurfaceHigh, borderRadius: 14, padding: 12 }}>
                                <TouchableOpacity onPress={() => setShowSavePresetModal(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, marginBottom: 8, borderRadius: 10, borderWidth: 1.5, borderColor: THEME.primary, borderStyle: 'dashed', gap: 6 }}>
                                  <MaterialIcons name="add" size={18} color={THEME.primary} />
                                  <Text style={{ color: THEME.primary, fontSize: 12, fontWeight: '700' }}>Save Current as Preset</Text>
                                </TouchableOpacity>
                                {userPresets.length === 0 ? (
                                  <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                                    <MaterialIcons name="bookmark-border" size={32} color={THEME.textMuted} />
                                    <Text style={{ color: THEME.textMuted, fontSize: 11, marginTop: 6 }}>No saved presets yet</Text>
                                  </View>
                                ) : (
                                  userPresets.map(p => (
                                    <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', padding: 10, marginBottom: 4, borderRadius: 8, backgroundColor: THEME.bgSurface }}>
                                      <TouchableOpacity onPress={() => applyUserPreset(p)} style={{ flex: 1 }}>
                                        <Text style={{ color: THEME.textMain, fontSize: 12, fontWeight: '600' }}>{p.name}</Text>
                                        <Text style={{ color: THEME.textMuted, fontSize: 9, marginTop: 2 }}>{new Date(p.createdAt).toLocaleDateString()}</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity onPress={() => deleteUserPreset(p.id)} style={{ padding: 6 }}>
                                        <MaterialIcons name="delete-outline" size={18} color={THEME.textMuted} />
                                      </TouchableOpacity>
                                    </View>
                                  ))
                                )}
                              </View>
                            )}

                            {/* CURVES */}
                            {proActiveSection === 'curves' && (() => {
                              const hasCustomCurve = curveR.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01) || curveG.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01) || curveB.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01) || curveMaster.some((v: number, i: number) => Math.abs(v - i / 16) > 0.01);
                              return (
                                <View style={{ backgroundColor: THEME.bgSurfaceHigh, borderRadius: 14, padding: 12 }}>
                                  <TouchableOpacity onPress={() => setShowCurveEditor(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, backgroundColor: THEME.bgSurface, borderRadius: 12, borderWidth: 1, borderColor: '#3a3b3e' }}>
                                    <MaterialIcons name="show-chart" size={22} color={THEME.primary} />
                                    <Text style={{ color: THEME.textMain, fontSize: 13, fontWeight: '600' }}>Open Curve Editor</Text>
                                    <MaterialIcons name="open-in-new" size={14} color={THEME.textMuted} />
                                  </TouchableOpacity>
                                  {hasCustomCurve && (
                                    <TouchableOpacity onPress={() => { const def = [{ x: 0, y: 0 }, { x: 1, y: 1 }]; setCurveCpR([...def]); setCurveCpG([...def]); setCurveCpB([...def]); setCurveCpMaster([...def]); setCurveR([...IDENTITY_CURVE_17]); setCurveG([...IDENTITY_CURVE_17]); setCurveB([...IDENTITY_CURVE_17]); setCurveMaster([...IDENTITY_CURVE_17]); }} style={{ marginTop: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: THEME.bgSurface }}>
                                      <MaterialIcons name="refresh" size={14} color={THEME.textMuted} />
                                      <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600' }}>Reset Curves</Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              );
                            })()}

                            {/* COLOR MIX (HSL) */}
                            {proActiveSection === 'hsl' && (() => {
                              const selCh = HSL_CHANNELS.find(c => c.key === activeHslChannel) || HSL_CHANNELS[0];
                              const hslArr: [number, number, number] = [...(hslValues[selCh.key] || [0, 0, 0])] as [number, number, number];
                              return (
                                <View style={{ backgroundColor: THEME.bgSurfaceHigh, borderRadius: 14, padding: 12 }}>
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                                    {HSL_CHANNELS.map(ch => {
                                      const isActive = activeHslChannel === ch.key;
                                      const hasChange = (hslValues[ch.key] || [0,0,0]).some(v => v !== 0);
                                      return (
                                        <TouchableOpacity key={ch.key} onPress={() => setActiveHslChannel(ch.key)} style={{ alignItems: 'center' }}>
                                          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: ch.color, borderWidth: isActive ? 3 : 1.5, borderColor: isActive ? '#fff' : 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' }}>
                                            {isActive && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} />}
                                            {!isActive && hasChange && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />}
                                          </View>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                  {([
                                    { label: 'Hue', idx: 0, min: -180, max: 180, unit: '°' },
                                    { label: 'Saturation', idx: 1, min: -100, max: 100, unit: '' },
                                    { label: 'Luminance', idx: 2, min: -100, max: 100, unit: '' },
                                  ] as const).map(({ label, idx, min, max, unit }) => {
                                    const val = hslArr[idx];
                                    return (
                                      <View key={label} style={{ marginBottom: 12 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                          <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: '500' }}>{label}</Text>
                                          <Text style={{ color: val !== 0 ? THEME.textMain : THEME.textMuted, fontSize: 13, fontWeight: '700' }}>{Math.round(val)}{unit}</Text>
                                        </View>
                                        <CustomSlider min={min} max={max} step={1} value={val}
                                          onChange={(v: number) => {
                                            setHslValues(prev => {
                                              const copy = { ...prev };
                                              const arr: [number, number, number] = [...(copy[selCh.key] || [0,0,0])] as [number, number, number];
                                              arr[idx] = v;
                                              copy[selCh.key] = arr;
                                              return copy;
                                            });
                                          }}
                                          onScrollLock={setPanelScrollEnabled}
                                        />
                                      </View>
                                    );
                                  })}
                                  <View style={{ flexDirection: 'row', gap: 8 }}>
                                    <TouchableOpacity onPress={() => setHslValues(prev => ({ ...prev, [selCh.key]: [0, 0, 0] }))} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, backgroundColor: THEME.bgSurface }}>
                                      <MaterialIcons name="refresh" size={13} color={THEME.textMuted} />
                                      <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600' }}>Reset {selCh.key}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => setHslValues({ ...DEFAULT_HSL })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 8, backgroundColor: THEME.bgSurface }}>
                                      <MaterialIcons name="refresh" size={13} color={THEME.textMuted} />
                                      <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600' }}>Reset All</Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              );
                            })()}

                          </ScrollView>
                        )}
                      </View>
                    )}

                    {activeTab === 'stickers' && ( 
                      <View style={{flex: 1}}>
                        {/* Sticker selected - show adjustment bar */}
                        {activeAnyEl && activeAnyEl.type === 'image' && (
                          <View style={{ flex: 1 }}>
                              <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={panelScrollEnabled} contentContainerStyle={{ paddingBottom: 20, paddingTop: 4 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                  <TouchableOpacity onPress={duplicateElement} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 12, gap: 6 }}>
                                    <MaterialIcons name="content-copy" size={16} color={THEME.textMain} />
                                    <Text style={{ color: THEME.textMain, fontSize: 11, fontWeight: '600' }}>Duplicate</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity onPress={() => moveLayer('up')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 12, gap: 6 }}>
                                    <MaterialIcons name="flip-to-front" size={16} color={THEME.textMain} />
                                    <Text style={{ color: THEME.textMain, fontSize: 11, fontWeight: '600' }}>Front</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity onPress={() => moveLayer('down')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 12, gap: 6 }}>
                                    <MaterialIcons name="flip-to-back" size={16} color={THEME.textMain} />
                                    <Text style={{ color: THEME.textMain, fontSize: 11, fontWeight: '600' }}>Back</Text>
                                  </TouchableOpacity>
                                </View>
                                <ProSlider icon="opacity" label="Sticker Opacity" value={activeAnyEl.opacity || 1} min={0.1} max={1} step={0.1} displayValue={`${Math.round((activeAnyEl.opacity || 1) * 100)}%`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('opacity', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <View style={{ height: 8 }} />
                                <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Position & Rotation</Text>
                                <ProSlider icon="swap-horiz" label="Position X" value={activeAnyEl.x || 0} min={-Math.round(renderedW / 2)} max={Math.round(renderedW / 2)} step={1} displayValue={`${Math.round(activeAnyEl.x || 0)}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('x', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="swap-vert" label="Position Y" value={activeAnyEl.y || 0} min={-Math.round(renderedH / 2)} max={Math.round(renderedH / 2)} step={1} displayValue={`${Math.round(activeAnyEl.y || 0)}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('y', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="rotate-right" label="Rotation" value={activeAnyEl.rotation || 0} min={-180} max={180} step={1} displayValue={`${Math.round(activeAnyEl.rotation || 0)}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('rotation', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <View style={{ height: 8 }} />
                                <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>3D Transform {!isPro ? '✨' : ''}</Text>
                                <ProSlider icon="flip" label="Rotate X (Tilt)" value={activeAnyEl.rotateX || 0} min={-90} max={90} step={1} displayValue={`${Math.round(activeAnyEl.rotateX || 0)}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('rotateX', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="flip" label="Rotate Y (Swing)" value={activeAnyEl.rotateY || 0} min={-90} max={90} step={1} displayValue={`${Math.round(activeAnyEl.rotateY || 0)}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('rotateY', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="rotate-right" label="Rotate Z (Spin)" value={activeAnyEl.rotateZ || 0} min={-180} max={180} step={1} displayValue={`${Math.round(activeAnyEl.rotateZ || 0)}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('rotateZ', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="zoom-in" label="Scale" value={activeAnyEl.scale || 1} min={0.1} max={4} step={0.05} displayValue={`${(activeAnyEl.scale || 1).toFixed(2)}x`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('scale', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <View style={{ height: 8 }} />
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <MaterialIcons name="person" size={14} color={THEME.textMuted} style={{ marginRight: 6 }} />
                                    <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Behind Subject</Text>
                                    <MaterialIcons name="star" size={10} color={THEME.primary} style={{ marginLeft: 6 }} />
                                  </View>
                                  <TouchableOpacity onPress={() => {
                                    const newVal = !activeAnyEl.behindSubject;
                                    updateStyleWithHistory('behindSubject', newVal);
                                    if (newVal && (typeof activeAnyEl.behindDepth !== 'number' || activeAnyEl.behindDepth <= 0)) {
                                      updateStyleWithHistory('behindDepth', 1);
                                    }
                                    if (newVal && !subjectCutoutUri && bgImage) {
                                      generateSubjectCutout(bgImage);
                                    }
                                  }} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: activeAnyEl.behindSubject ? THEME.primary : '#3a3b3e', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: activeAnyEl.behindSubject ? 'flex-end' : 'flex-start', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 1 }} />
                                  </TouchableOpacity>
                                </View>
                                {activeAnyEl.behindSubject && (
                                  <ProSlider
                                    icon="layers"
                                    label="Behind Depth"
                                    value={typeof activeAnyEl.behindDepth === 'number' ? activeAnyEl.behindDepth : 1}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    displayValue={`${Math.round(((typeof activeAnyEl.behindDepth === 'number' ? activeAnyEl.behindDepth : 1)) * 100)}%`}
                                    onStart={handleSliderStart}
                                    onChange={(v:number) => updateSelectedStyle('behindDepth', v)}
                                    onComplete={handleSliderComplete}
                                    onScrollLock={setPanelScrollEnabled}
                                  />
                                )}
                                {isSegmenting && <ActivityIndicator size="small" color={THEME.primary} style={{ marginBottom: 8 }} />}
                                {activeAnyEl.behindSubject && subjectCutoutUri && (
                                  <TouchableOpacity onPress={openMaskEditor} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#3a3b3e' }}>
                                    <MaterialIcons name="brush" size={14} color={THEME.primary} />
                                    <Text style={{ color: THEME.textMain, fontSize: 11, fontWeight: '600' }}>Edit Subject Mask</Text>
                                  </TouchableOpacity>
                                )}
                                {activeAnyEl.behindSubject && (
                                  <View style={{ marginBottom: 8 }}>
                                    <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Edge Precision</Text>
                                    <View style={{ flexDirection: 'row', gap: 6 }}>
                                      {(['soft', 'normal', 'hard'] as const).map((p) => (
                                        <TouchableOpacity
                                          key={p}
                                          onPress={() => {
                                            if (edgePrecision !== p) {
                                              setEdgePrecision(p);
                                              if (bgImage) {
                                                setSubjectCutoutUri(null);
                                                setSubjectMaskUri(null);
                                                generateSubjectCutout(bgImage);
                                              }
                                            }
                                          }}
                                          style={{ flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: edgePrecision === p ? THEME.primary : THEME.bgSurfaceHigh, alignItems: 'center', borderWidth: 1, borderColor: edgePrecision === p ? THEME.primary : '#3a3b3e' }}
                                        >
                                          <Text style={{ color: edgePrecision === p ? THEME.bgBase : THEME.textMuted, fontSize: 11, fontWeight: '600' }}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                                        </TouchableOpacity>
                                      ))}
                                    </View>
                                  </View>
                                )}
                                {activeAnyEl.isTintable && (<>
                                <View style={[styles.colorTargetRow, { marginTop: 12 }]}>
                                  <TouchableOpacity style={[styles.colorTargetBtn, stickerColorTarget === 'color' && styles.colorTargetBtnActive]} onPress={() => setStickerColorTarget('color')}>
                                    <Text style={[styles.colorTargetText, stickerColorTarget === 'color' && styles.colorTargetTextActive]}>Color</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity style={[styles.colorTargetBtn, stickerColorTarget === 'shadow' && styles.colorTargetBtnActive]} onPress={() => setStickerColorTarget('shadow')}>
                                    <Text style={[styles.colorTargetText, stickerColorTarget === 'shadow' && styles.colorTargetTextActive]}>Shadow {!isPro ? '✨' : ''}</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity style={[styles.colorTargetBtn, stickerColorTarget === 'stroke' && styles.colorTargetBtnActive]} onPress={() => setStickerColorTarget('stroke')}>
                                    <Text style={[styles.colorTargetText, stickerColorTarget === 'stroke' && styles.colorTargetTextActive]}>Stroke {!isPro ? '✨' : ''}</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity style={[styles.colorTargetBtn, stickerColorTarget === 'glow' && styles.colorTargetBtnActive]} onPress={() => setStickerColorTarget('glow')}>
                                    <Text style={[styles.colorTargetText, stickerColorTarget === 'glow' && styles.colorTargetTextActive]}>Glow {!isPro ? '✨' : ''}</Text>
                                  </TouchableOpacity>
                                </View>
                                {stickerColorTarget === 'color' ? (<>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 30, marginBottom: 8 }}>
                                  {[...colorCategories, { id: 'custom', label: 'Custom', colors: [] }].map(cat => (
                                    <TouchableOpacity key={cat.id} onPress={() => gatedSetColorCategory(cat.id)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: colorCategoryId === cat.id ? THEME.primary : THEME.bgSurfaceHigh, marginRight: 6 }}>
                                      <Text style={{ color: colorCategoryId === cat.id ? THEME.bgBase : THEME.textMuted, fontSize: 11, fontWeight: '600' }}>{cat.label}{(cat.id === 'gradient' || cat.id === 'custom') && !isPro ? ' ✨' : ''}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </ScrollView>
                                {colorCategoryId !== 'custom' ? (
                                  <View style={styles.colorPaletteGrid}>
                                    {(colorCategories.find(c => c.id === colorCategoryId)?.colors || COLOR_PALETTE).map((color) => {
                                      const isActive = activeAnyEl.color === color;
                                      const isGrad = color.startsWith('gradient:');
                                      if (isGrad) {
                                        const [c1, c2] = color.replace('gradient:', '').split(',');
                                        return (
                                          <TouchableOpacity key={color} onPress={() => updateStyleWithHistory('color', color)} style={[{ width: 44, height: 44, borderRadius: 22, borderWidth: 2.5, borderColor: isActive ? THEME.primary : THEME.bgSurfaceHigh, overflow: 'hidden', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3 }]}>
                                            <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                                            {isActive && <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' }}><MaterialIcons name="check" size={18} color="#fff" /></View>}
                                          </TouchableOpacity>
                                        );
                                      }
                                      return (
                                        <TouchableOpacity key={color} onPress={() => updateStyleWithHistory('color', color)} style={[styles.colorGridSwatch, { backgroundColor: color, borderColor: isActive ? THEME.textMain : 'transparent' }]} />
                                      );
                                    })}
                                  </View>
                                ) : (
                                  <View style={{ gap: 6 }}>
                                    <View style={{ height: 36, borderRadius: 8, backgroundColor: hsvToHex(customHue, customSat, customVal), borderWidth: 1, borderColor: THEME.bgSurfaceHigh }} />
                                    <ProSlider icon="palette" label="Hue" value={customHue} min={0} max={359} step={1} displayValue={`${Math.round(customHue)}°`} onChange={(v: number) => { setCustomHue(v); updateStyleWithHistory('color', hsvToHex(v, customSat, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                    <ProSlider icon="opacity" label="Saturation" value={customSat * 100} min={0} max={100} step={1} displayValue={`${Math.round(customSat * 100)}%`} onChange={(v: number) => { setCustomSat(v / 100); updateStyleWithHistory('color', hsvToHex(customHue, v / 100, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                    <ProSlider icon="brightness-6" label="Brightness" value={customVal * 100} min={0} max={100} step={1} displayValue={`${Math.round(customVal * 100)}%`} onChange={(v: number) => { setCustomVal(v / 100); updateStyleWithHistory('color', hsvToHex(customHue, customSat, v / 100)); }} onScrollLock={setPanelScrollEnabled} />
                                  </View>
                                )}
                                </>) : stickerColorTarget === 'shadow' ? (<>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' }}>Enable Shadow</Text>
                                  <TouchableOpacity onPress={() => toggleShadow(!((activeAnyEl.shadowOpacity || 0) > 0))} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: (activeAnyEl.shadowOpacity || 0) > 0 ? THEME.primary : '#3a3b3e', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: (activeAnyEl.shadowOpacity || 0) > 0 ? 'flex-end' : 'flex-start', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 1 }} />
                                  </TouchableOpacity>
                                </View>
                                {(activeAnyEl.shadowOpacity || 0) > 0 && (<>
                                <ProSlider icon="opacity" label="Shadow Opacity" value={(activeAnyEl.shadowOpacity || 0) * 100} min={0} max={100} step={5} displayValue={`${Math.round((activeAnyEl.shadowOpacity || 0) * 100)}%`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowOpacity', v / 100)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <View style={{ height: 4 }} />
                                <ProSlider icon="blur-on" label="Shadow Blur" value={activeAnyEl.shadowBlur || 1} min={1} max={30} step={1} displayValue={`${Math.round(activeAnyEl.shadowBlur || 1)}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowBlur', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <View style={{ height: 4 }} />
                                <ProSlider icon="open-with" label="Shadow Distance" value={activeAnyEl.shadowDistance || 0} min={0} max={30} step={1} displayValue={`${Math.round(activeAnyEl.shadowDistance || 0)}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowDistance', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <View style={{ height: 4 }} />
                                <ProSlider icon="rotate-right" label="Shadow Angle" value={activeAnyEl.shadowAngle || 135} min={0} max={360} step={15} displayValue={`${Math.round(activeAnyEl.shadowAngle || 135)}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowAngle', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <View style={{ height: 4 }} />
                                <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 4 }}>Shadow Color</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 30, marginBottom: 8 }}>
                                  {[...colorCategories, { id: 'custom', label: 'Custom', colors: [] }].map(cat => (
                                    <TouchableOpacity key={cat.id} onPress={() => gatedSetColorCategory(cat.id)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: colorCategoryId === cat.id ? THEME.primary : THEME.bgSurfaceHigh, marginRight: 6 }}>
                                      <Text style={{ color: colorCategoryId === cat.id ? THEME.bgBase : THEME.textMuted, fontSize: 11, fontWeight: '600' }}>{cat.label}{(cat.id === 'gradient' || cat.id === 'custom') && !isPro ? ' ✨' : ''}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </ScrollView>
                                {colorCategoryId !== 'custom' ? (
                                  <View style={styles.colorPaletteGrid}>
                                    {(colorCategories.find(c => c.id === colorCategoryId)?.colors || COLOR_PALETTE).map((color) => {
                                      const isActive = (activeAnyEl.shadowColor || '#000000') === color;
                                      return (
                                        <TouchableOpacity key={color} onPress={() => updateStyleWithHistory('shadowColor', color)} style={[styles.colorGridSwatch, { backgroundColor: color, borderColor: isActive ? THEME.textMain : 'transparent', width: 26, height: 26 }]} />
                                      );
                                    })}
                                  </View>
                                ) : (
                                  <View style={{ gap: 6 }}>
                                    <View style={{ height: 36, borderRadius: 8, backgroundColor: hsvToHex(customHue, customSat, customVal), borderWidth: 1, borderColor: THEME.bgSurfaceHigh }} />
                                    <ProSlider icon="palette" label="Hue" value={customHue} min={0} max={359} step={1} displayValue={`${Math.round(customHue)}°`} onChange={(v: number) => { setCustomHue(v); updateStyleWithHistory('shadowColor', hsvToHex(v, customSat, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                    <ProSlider icon="opacity" label="Saturation" value={customSat * 100} min={0} max={100} step={1} displayValue={`${Math.round(customSat * 100)}%`} onChange={(v: number) => { setCustomSat(v / 100); updateStyleWithHistory('shadowColor', hsvToHex(customHue, v / 100, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                    <ProSlider icon="brightness-6" label="Brightness" value={customVal * 100} min={0} max={100} step={1} displayValue={`${Math.round(customVal * 100)}%`} onChange={(v: number) => { setCustomVal(v / 100); updateStyleWithHistory('shadowColor', hsvToHex(customHue, customSat, v / 100)); }} onScrollLock={setPanelScrollEnabled} />
                                  </View>
                                )}
                                </>)}
                                </>) : stickerColorTarget === 'stroke' ? (<>
                                {/* Sticker Stroke */}
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' }}>Stroke</Text>
                                  <TouchableOpacity onPress={() => toggleStroke(!((activeAnyEl.strokeWidth || 0) > 0))} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: (activeAnyEl.strokeWidth || 0) > 0 ? THEME.primary : '#3a3b3e', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: (activeAnyEl.strokeWidth || 0) > 0 ? 'flex-end' : 'flex-start', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 1 }} />
                                  </TouchableOpacity>
                                </View>
                                {(activeAnyEl.strokeWidth || 0) > 0 && (<>
                                  <ProSlider icon="line-weight" label="Thickness" value={activeAnyEl.strokeWidth || 2} min={1} max={8} step={0.5} displayValue={`${activeAnyEl.strokeWidth || 2}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('strokeWidth', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                  <View style={{ height: 4 }} />
                                  <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 4 }}>Stroke Color</Text>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 30, marginBottom: 8 }}>
                                    {[...colorCategories, { id: 'custom', label: 'Custom', colors: [] }].map(cat => (
                                      <TouchableOpacity key={cat.id} onPress={() => gatedSetColorCategory(cat.id)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: colorCategoryId === cat.id ? THEME.primary : THEME.bgSurfaceHigh, marginRight: 6 }}>
                                        <Text style={{ color: colorCategoryId === cat.id ? THEME.bgBase : THEME.textMuted, fontSize: 11, fontWeight: '600' }}>{cat.label}{(cat.id === 'gradient' || cat.id === 'custom') && !isPro ? ' ✨' : ''}</Text>
                                      </TouchableOpacity>
                                    ))}
                                  </ScrollView>
                                  {colorCategoryId !== 'custom' ? (
                                    <View style={styles.colorPaletteGrid}>
                                      {(colorCategories.find(c => c.id === colorCategoryId)?.colors || COLOR_PALETTE).map((color) => {
                                        const isActive = (activeAnyEl.strokeColor || '#000000') === color;
                                        return (
                                          <TouchableOpacity key={color} onPress={() => updateStyleWithHistory('strokeColor', color)} style={[styles.colorGridSwatch, { backgroundColor: color, borderColor: isActive ? THEME.textMain : 'transparent', width: 26, height: 26 }]} />
                                        );
                                      })}
                                    </View>
                                  ) : (
                                    <View style={{ gap: 6 }}>
                                      <View style={{ height: 36, borderRadius: 8, backgroundColor: hsvToHex(customHue, customSat, customVal), borderWidth: 1, borderColor: THEME.bgSurfaceHigh }} />
                                      <ProSlider icon="palette" label="Hue" value={customHue} min={0} max={359} step={1} displayValue={`${Math.round(customHue)}°`} onChange={(v: number) => { setCustomHue(v); updateStyleWithHistory('strokeColor', hsvToHex(v, customSat, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                      <ProSlider icon="opacity" label="Saturation" value={customSat * 100} min={0} max={100} step={1} displayValue={`${Math.round(customSat * 100)}%`} onChange={(v: number) => { setCustomSat(v / 100); updateStyleWithHistory('strokeColor', hsvToHex(customHue, v / 100, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                      <ProSlider icon="brightness-6" label="Brightness" value={customVal * 100} min={0} max={100} step={1} displayValue={`${Math.round(customVal * 100)}%`} onChange={(v: number) => { setCustomVal(v / 100); updateStyleWithHistory('strokeColor', hsvToHex(customHue, customSat, v / 100)); }} onScrollLock={setPanelScrollEnabled} />
                                    </View>
                                  )}
                                </>)}

                                </>) : (<>
                                {/* Sticker Glow */}
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' }}>Glow</Text>
                                  <TouchableOpacity onPress={() => toggleGlow(!((activeAnyEl.glowOpacity || 0) > 0))} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: (activeAnyEl.glowOpacity || 0) > 0 ? THEME.primary : '#3a3b3e', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: (activeAnyEl.glowOpacity || 0) > 0 ? 'flex-end' : 'flex-start', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 1 }} />
                                  </TouchableOpacity>
                                </View>
                                {(activeAnyEl.glowOpacity || 0) > 0 && (<>
                                  <ProSlider icon="blur-on" label="Glow Radius" value={activeAnyEl.glowRadius || 8} min={2} max={30} step={1} displayValue={`${activeAnyEl.glowRadius || 8}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('glowRadius', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                  <View style={{ height: 4 }} />
                                  <ProSlider icon="visibility" label="Glow Intensity" value={activeAnyEl.glowOpacity || 0} min={0.1} max={1} step={0.1} displayValue={`${Math.round((activeAnyEl.glowOpacity || 0) * 100)}%`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('glowOpacity', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                  <View style={{ height: 4 }} />
                                  <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 4 }}>Glow Color</Text>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 30, marginBottom: 8 }}>
                                    {[...colorCategories, { id: 'custom', label: 'Custom', colors: [] }].map(cat => (
                                      <TouchableOpacity key={cat.id} onPress={() => gatedSetColorCategory(cat.id)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: colorCategoryId === cat.id ? THEME.primary : THEME.bgSurfaceHigh, marginRight: 6 }}>
                                        <Text style={{ color: colorCategoryId === cat.id ? THEME.bgBase : THEME.textMuted, fontSize: 11, fontWeight: '600' }}>{cat.label}{(cat.id === 'gradient' || cat.id === 'custom') && !isPro ? ' ✨' : ''}</Text>
                                      </TouchableOpacity>
                                    ))}
                                  </ScrollView>
                                  {colorCategoryId !== 'custom' ? (
                                    <View style={styles.colorPaletteGrid}>
                                      {(colorCategories.find(c => c.id === colorCategoryId)?.colors || COLOR_PALETTE).map((color) => {
                                        const isActive = (activeAnyEl.glowColor || '#FFFFFF') === color;
                                        return (
                                          <TouchableOpacity key={color} onPress={() => updateStyleWithHistory('glowColor', color)} style={[styles.colorGridSwatch, { backgroundColor: color, borderColor: isActive ? THEME.textMain : 'transparent', width: 26, height: 26 }]} />
                                        );
                                      })}
                                    </View>
                                  ) : (
                                    <View style={{ gap: 6 }}>
                                      <View style={{ height: 36, borderRadius: 8, backgroundColor: hsvToHex(customHue, customSat, customVal), borderWidth: 1, borderColor: THEME.bgSurfaceHigh }} />
                                      <ProSlider icon="palette" label="Hue" value={customHue} min={0} max={359} step={1} displayValue={`${Math.round(customHue)}°`} onChange={(v: number) => { setCustomHue(v); updateStyleWithHistory('glowColor', hsvToHex(v, customSat, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                      <ProSlider icon="opacity" label="Saturation" value={customSat * 100} min={0} max={100} step={1} displayValue={`${Math.round(customSat * 100)}%`} onChange={(v: number) => { setCustomSat(v / 100); updateStyleWithHistory('glowColor', hsvToHex(customHue, v / 100, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                      <ProSlider icon="brightness-6" label="Brightness" value={customVal * 100} min={0} max={100} step={1} displayValue={`${Math.round(customVal * 100)}%`} onChange={(v: number) => { setCustomVal(v / 100); updateStyleWithHistory('glowColor', hsvToHex(customHue, customSat, v / 100)); }} onScrollLock={setPanelScrollEnabled} />
                                    </View>
                                  )}
                                </>)}
                                </>)}
                                </>)}
                              </ScrollView>
                          </View>
                        )}
                        {!(activeAnyEl && activeAnyEl.type === 'image') && (<>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryRow}>
                          {packs.map(pack => ( 
                            <TouchableOpacity key={pack.id} style={[styles.categoryPill, activePackId === pack.id && styles.categoryPillActive, pack.isPremium && proStyles.categoryPill]} onPress={() => { setActivePackId(pack.id); }}>
                              {pack.isPremium && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 5, backgroundColor: isPro ? 'rgba(221,198,22,0.18)' : 'rgba(221,198,22,0.12)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                                  <MaterialIcons name={isPro ? 'star' : 'lock'} size={9} color={THEME.primary} />
                                  <Text style={{ color: THEME.primary, fontSize: 9, fontWeight: '700' }}>{isPro ? 'PRO' : 'PRO'}</Text>
                                </View>
                              )}
                              <Text style={[styles.categoryText, activePackId === pack.id && styles.categoryTextActive, pack.isPremium && { color: THEME.primary }]}>{pack.name}</Text>
                            </TouchableOpacity> 
                          ))}
                        </ScrollView>
                          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                            {packs.find(p => p.id === activePackId)?.stickers.map((sticker, idx) => {
                              const previewColor = sticker.isTintable ? COLOR_PALETTE[idx % COLOR_PALETTE.length] : undefined;
                              const currentPack = packs.find(p => p.id === activePackId);
                              return (
                              <TouchableOpacity key={sticker.id} style={{ width: '47%', aspectRatio: 1, backgroundColor: 'transparent', borderRadius: 16, justifyContent: 'center', alignItems: 'center' }} onPress={() => { 
                                commitHistory(prev => [...prev, { id: Date.now().toString(), type: 'image', src: sticker.src, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, isTintable: sticker.isTintable, color: sticker.isTintable ? previewColor : undefined, behindSubject: false, isPremiumPack: currentPack?.isPremium || false }]); 
                                setSelectedId(null); 
                              }}>
                                <Image source={{ uri: sticker.src }} style={[{ width: '75%', height: '75%' }, sticker.isTintable && previewColor ? { tintColor: previewColor } : null]} resizeMode="contain" />
                              </TouchableOpacity>
                              );
                            })}
                            </View>
                          </ScrollView> 
                        </>)}
                      </View> 
                    )}

                    {activeTab === 'text' && ( 
                      <View style={{flex: 1}}>
                        {/* Back to Group button when editing individual group elements */}
                        {groupEditMode && selectedGroupId && (
                          <TouchableOpacity onPress={() => { setGroupEditMode(false); setSelectedId(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8, backgroundColor: THEME.primary, borderRadius: 12, alignSelf: 'flex-start', shadowColor: THEME.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4 }}>
                            <MaterialIcons name="check-circle" size={16} color={THEME.bgBase} />
                            <Text style={{ color: THEME.bgBase, fontSize: 12, fontWeight: '700' }}>Done Editing</Text>
                          </TouchableOpacity>
                        )}
                        {!activeTextEl ? ( 
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 8 }}>
                              <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' }}>ಕನ್ನಡ Presets</Text>
                              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 }} onPress={() => {setSelectedId(null); setCurrentText(''); setIsTyping(true);}}>
                                <MaterialIcons name="add" size={14} color={THEME.bgBase} style={{ marginRight: 4 }} />
                                <Text style={{ color: THEME.bgBase, fontSize: 11, fontWeight: '700' }}>Custom Text</Text>
                              </TouchableOpacity>
                            </View>
                            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                              {/* ── Design Templates ── */}
                              {textDesignTemplates.length > 0 && (
                                <View style={{ marginBottom: 12 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 4 }}>
                                    <MaterialIcons name="auto-awesome" size={12} color={THEME.primary} />
                                    <Text style={{ color: THEME.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>DESIGN TEMPLATES</Text>
                                  </View>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
                                    {textDesignTemplates.map(tpl => (
                                      <TouchableOpacity key={tpl.id} onPress={() => {
                                        // Create a single element with templateLines
                                        const newEl: CanvasElement = {
                                          id: `${Date.now()}`,
                                          type: 'text' as ElementType,
                                          content: tpl.lines.map(l => l.text).join('\n'),
                                          color: tpl.lines[0]?.color || '#FFFFFF',
                                          fontFamily: tpl.lines[0]?.fontFamily,
                                          fontSize: tpl.lines[0]?.fontSize || 32,
                                          isBold: false,
                                          isItalic: false,
                                          isUnderline: false,
                                          textAlign: 'center' as const,
                                          opacity: 1,
                                          x: 0,
                                          y: 0,
                                          scale: 1,
                                          rotation: 0,
                                          width: 280,
                                          shadowColor: '#000000',
                                          shadowBlur: 0,
                                          shadowDistance: 0,
                                          shadowAngle: 45,
                                          shadowOpacity: 0,
                                          behindSubject: false,
                                          templateLines: tpl.lines.map(l => ({
                                            text: l.text,
                                            fontFamily: l.fontFamily,
                                            fontSize: l.fontSize,
                                            color: l.color,
                                            letterSpacing: l.letterSpacing || 0,
                                            isBold: !!l.isBold,
                                          })),
                                        };
                                        commitHistory(prev => [...prev, newEl]);
                                        setSelectedId(newEl.id);
                                        setSelectedGroupId(null);
                                        setGroupEditMode(false);
                                      }} style={{ width: 120, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#3a3b3e' }}>
                                        <Text style={{ color: THEME.textMuted, fontSize: 8, fontWeight: '600', letterSpacing: 0.3, marginBottom: 4 }}>{tpl.category}</Text>
                                        {tpl.lines.map((line, i) => (
                                          <Text key={i} style={{ fontFamily: line.fontFamily, color: line.color, fontSize: Math.min(line.fontSize * 0.4, 14), textAlign: 'center', lineHeight: Math.min(line.fontSize * 0.5, 18) }} numberOfLines={1}>{line.text}</Text>
                                        ))}
                                        <Text style={{ color: THEME.textMuted, fontSize: 8, marginTop: 4, textAlign: 'center' }}>{tpl.name}</Text>
                                      </TouchableOpacity>
                                    ))}
                                  </ScrollView>
                                </View>
                              )}
                              {/* ── Regular presets ── */}
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                {textPresets.map((preset) => (
                                  <TouchableOpacity 
                                    key={preset.id} 
                                    style={{ width: '48%', backgroundColor: THEME.bgSurfaceHigh, borderRadius: 14, padding: 12, minHeight: 70, justifyContent: 'center', borderWidth: 1, borderColor: '#3a3b3e' }}
                                    onPress={() => {
                                      const newId = Date.now().toString();
                                      commitHistory(prev => [...prev, { 
                                        id: newId, type: 'text' as ElementType, content: preset.text, color: preset.color, 
                                        fontFamily: preset.font, isBold: false, isItalic: false, isUnderline: false, 
                                        textAlign: 'center', opacity: 1, fontSize: preset.fontSize, 
                                        lineHeight: Math.round(preset.fontSize * 1.4), letterSpacing: preset.letterSpacing, 
                                        x: 0, y: 0, scale: 1, rotation: 0, width: 280, 
                                        shadowColor: '#000000', shadowBlur: preset.shadowBlur, 
                                        shadowDistance: preset.shadowDistance, shadowAngle: 45, shadowOpacity: preset.shadowOpacity,
                                        behindSubject: false,
                                      }]);
                                      setTimeout(() => setSelectedId(newId), 50);
                                    }}
                                  >
                                    <Text 
                                      style={{ 
                                        fontFamily: preset.font, color: preset.color, fontSize: 16, 
                                        textAlign: 'center', lineHeight: 22,
                                        textShadowColor: preset.shadowOpacity > 0 ? `rgba(0,0,0,${preset.shadowOpacity})` : 'transparent',
                                        textShadowOffset: { width: 1, height: 1 }, textShadowRadius: preset.shadowBlur > 0 ? 3 : 0
                                      }} 
                                      numberOfLines={3}
                                    >
                                      {preset.text}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </ScrollView>
                          </View> 
                        ) : ( 
                          <View style={{flex: 1}}>
                            {/* Template line editors */}
                            {activeTextEl.templateLines && activeTextEl.templateLines.length > 0 && textSubTab === 'fonts' && (
                              <View style={{ marginBottom: 8 }}>
                                <Text style={{ color: THEME.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 }}>TEMPLATE LINES</Text>
                                <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
                                  {activeTextEl.templateLines.map((line: any, li: number) => (
                                    <View key={li} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                                      <TouchableOpacity onPress={() => {
                                        const colors = ['#FFFFFF', '#FFD700', '#FF6B6B', '#4FC3F7', '#81C784', '#EC4899', '#F59E0B', '#A78BFA'];
                                        const curIdx = colors.indexOf(line.color);
                                        const nextColor = colors[(curIdx + 1) % colors.length];
                                        const newLines = [...(activeTextEl.templateLines || [])];
                                        newLines[li] = { ...newLines[li], color: nextColor };
                                        commitHistory(prev => prev.map(e => e.id === selectedId ? { ...e, templateLines: newLines } : e));
                                      }} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: line.color, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }} />
                                      <TextInput
                                        value={line.text}
                                        onChangeText={(text) => {
                                          const newLines = [...(activeTextEl.templateLines || [])];
                                          newLines[li] = { ...newLines[li], text };
                                          commitHistory(prev => prev.map(e => e.id === selectedId ? { ...e, templateLines: newLines, content: newLines.map((l: any) => l.text).join('\n') } : e));
                                        }}
                                        style={{ flex: 1, color: THEME.textMain, fontSize: 13, fontFamily: line.fontFamily, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#3a3b3e' }}
                                        placeholderTextColor={THEME.textMuted}
                                        placeholder="Text..."
                                      />
                                    </View>
                                  ))}
                                </ScrollView>
                              </View>
                            )}
                            
                            {textSubTab === 'fonts' && (
                              <View style={{ flex: 1 }}>
                                <View style={{ height: 38, marginBottom: 8 }}>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 2, gap: 8 }}>
                                    {fontCategories.map((cat: FontCategory) => {
                                      const isActive = activeFontCategoryId === cat.id;
                                      return (
                                        <TouchableOpacity 
                                          key={cat.id} 
                                          onPress={() => {
                                            setActiveFontCategoryId(cat.id);
                                          }}
                                          style={{ height: 34, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 17, borderWidth: isActive ? 0 : 1.5, borderColor: '#3a3b3e', backgroundColor: isActive ? THEME.primary : 'transparent' }}
                                        >
                                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', color: isActive ? THEME.bgBase : THEME.textMain }}>{cat.name}</Text>
                                          </View>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </ScrollView>
                                </View>
                                {/* Custom font upload button */}
                                {isPro && (
                                <TouchableOpacity onPress={uploadCustomFont} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, marginBottom: 6, borderRadius: 8, borderWidth: 1.5, borderColor: THEME.primary, borderStyle: 'dashed', gap: 6 }}>
                                  <MaterialIcons name="file-upload" size={16} color={THEME.primary} />
                                  <Text style={{ color: THEME.primary, fontSize: 10, fontWeight: '700' }}>Upload Custom Font (.ttf/.otf)</Text>
                                </TouchableOpacity>
                                )}
                                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                                  {fontCategories.find(c => c.id === activeFontCategoryId)?.fonts.map((font: any) => {
                                    const isCoreFont = CORE_FONTS.some(cf => cf.value === font.value);
                                    const fontLocked = !isCoreFont && font.isPremium && !isPro;
                                    return (
                                    <TouchableOpacity 
                                      key={font.value} 
                                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, marginBottom: 4, borderRadius: 12, backgroundColor: activeTextEl.fontFamily === font.value ? 'rgba(221, 198, 22, 0.15)' : 'transparent' }}
                                      onPress={() => {
                                        if (activeTextEl.templateLines && activeTextEl.templateLines.length > 0) {
                                          // Apply font to all template lines
                                          const newLines = activeTextEl.templateLines.map((l: any) => ({ ...l, fontFamily: font.value }));
                                          commitHistory(prev => prev.map(e => e.id === selectedId ? { ...e, fontFamily: font.value, templateLines: newLines } : e));
                                        } else {
                                          updateStyleWithHistory('fontFamily', font.value);
                                        }
                                      }}
                                    >
                                      <Text style={{ fontFamily: font.value, fontSize: 18, color: activeTextEl.fontFamily === font.value ? THEME.primary : THEME.textMain, flex: 1 }}>
                                        {activeTextEl.content ? activeTextEl.content.substring(0, 20) : font.label}
                                      </Text>
                                      <Text style={{ fontSize: 10, color: THEME.textMuted }}>{font.label}</Text>
                                      {fontLocked && <MaterialIcons name="star" size={14} color={THEME.primary} style={{ marginLeft: 8 }} />}
                                      {!fontLocked && activeTextEl.fontFamily === font.value && <MaterialIcons name="check-circle" size={16} color={THEME.primary} style={{ marginLeft: 8 }} />}
                                    </TouchableOpacity>
                                    );
                                  })}
                                </ScrollView>
                              </View>
                            )}

                            {textSubTab === 'style' && ( 
                              <ScrollView style={styles.advancedMenu} showsVerticalScrollIndicator={false} scrollEnabled={panelScrollEnabled} contentContainerStyle={{ paddingBottom: 20 }}>
                                {/* Quick actions row */}
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                  <View style={styles.toggleGroup}>
                                    <TouchableOpacity style={[styles.stylePill, activeTextEl.textAlign === 'left' && styles.stylePillActive]} onPress={() => updateStyleWithHistory('textAlign', 'left')}><MaterialIcons name="format-align-left" size={14} color={activeTextEl.textAlign === 'left' ? THEME.bgBase : THEME.textMain} /></TouchableOpacity>
                                    <TouchableOpacity style={[styles.stylePill, activeTextEl.textAlign === 'center' && styles.stylePillActive]} onPress={() => updateStyleWithHistory('textAlign', 'center')}><MaterialIcons name="format-align-center" size={14} color={activeTextEl.textAlign === 'center' ? THEME.bgBase : THEME.textMain} /></TouchableOpacity>
                                    <TouchableOpacity style={[styles.stylePill, activeTextEl.textAlign === 'right' && styles.stylePillActive]} onPress={() => updateStyleWithHistory('textAlign', 'right')}><MaterialIcons name="format-align-right" size={14} color={activeTextEl.textAlign === 'right' ? THEME.bgBase : THEME.textMain} /></TouchableOpacity>
                                  </View>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                    <TouchableOpacity style={styles.proBtn} onPress={duplicateElement}><MaterialIcons name="content-copy" size={14} color={THEME.textMain}/></TouchableOpacity>
                                    <TouchableOpacity style={styles.proBtn} onPress={() => moveLayer('up')}><MaterialIcons name="flip-to-front" size={14} color={THEME.textMain}/></TouchableOpacity>
                                    <TouchableOpacity style={styles.proBtn} onPress={() => moveLayer('down')}><MaterialIcons name="flip-to-back" size={14} color={THEME.textMain}/></TouchableOpacity>
                                    <TouchableOpacity style={[styles.miniAddBtn]} onPress={() => {setSelectedId(null); setCurrentText(''); setIsTyping(true);}}>
                                      <MaterialIcons name="edit" size={16} color={THEME.textMain} />
                                    </TouchableOpacity>
                                  </View>
                                </View>

                                {/* Size & Spacing */}
                                <ProSlider icon="text-fields" label="Font Size" value={activeTextEl.fontSize || 45} min={15} max={120} step={1} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('fontSize', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="open-with" label="Letter Spacing" value={activeTextEl.letterSpacing || 0} min={-5} max={30} step={1} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('letterSpacing', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="menu" label="Line Height" value={activeTextEl.lineHeight || 65} min={20} max={150} step={1} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('lineHeight', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="layers" label="Opacity" value={activeTextEl.opacity || 1} min={0.1} max={1} step={0.1} displayValue={`${Math.round((activeTextEl.opacity || 1) * 100)}%`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('opacity', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />

                                {/* Blend Mode (Photoshop-style layer blend) */}
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 6 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <MaterialIcons name="layers" size={14} color={THEME.textMuted} style={{ marginRight: 6 }} />
                                    <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Blend Mode</Text>
                                  </View>
                                  <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'capitalize' }}>{(activeTextEl.blendMode || 'normal').replace('-', ' ')}</Text>
                                </View>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 12 }} style={{ marginBottom: 8 }}>
                                  {([
                                    'normal','multiply','screen','overlay','darken','lighten',
                                    'color-dodge','color-burn','hard-light','soft-light',
                                    'difference','exclusion','hue','saturation','color','luminosity'
                                  ] as const).map((mode) => {
                                    const active = (activeTextEl.blendMode || 'normal') === mode;
                                    return (
                                      <TouchableOpacity
                                        key={mode}
                                        onPress={() => updateStyleWithHistory('blendMode', mode)}
                                        style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: active ? THEME.primary : THEME.bgSurfaceHigh, marginRight: 6, borderWidth: 1, borderColor: active ? THEME.primary : '#3a3b3e' }}
                                      >
                                        <Text style={{ color: active ? THEME.bgBase : THEME.textMain, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>{mode.replace('-', ' ')}</Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </ScrollView>

                                {/* Text Shape (Curve) */}
                                <View style={{ height: 8 }} />
                                <Text style={[styles.sectionTitle, { marginBottom: 8 }]}>Text Shape</Text>
                                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                                  {([
                                    { key: 'none', label: '—', hint: 'Straight' },
                                    { key: 'arc', label: 'C', hint: 'Arc' },
                                    { key: 'wave', label: 'S', hint: 'Wave' },
                                    { key: 'circle', label: 'O', hint: 'Circle' },
                                  ] as const).map((sh) => {
                                    const active = (activeTextEl.textShape || 'none') === sh.key;
                                    return (
                                      <TouchableOpacity key={sh.key} onPress={() => {
                                        updateStyleWithHistory('textShape', sh.key);
                                        if (sh.key !== 'none' && !activeTextEl.textCurveAmount) {
                                          updateStyleWithHistory('textCurveAmount', 50);
                                        }
                                      }} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: active ? THEME.primary : THEME.bgSurfaceHigh, alignItems: 'center', borderWidth: 1, borderColor: active ? THEME.primary : '#3a3b3e' }}>
                                        <Text style={{ color: active ? THEME.bgBase : THEME.textMain, fontSize: 16, fontWeight: '800' }}>{sh.label}</Text>
                                        <Text style={{ color: active ? THEME.bgBase : THEME.textMuted, fontSize: 9, fontWeight: '600', marginTop: 2 }}>{sh.hint}</Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                                {(activeTextEl.textShape && activeTextEl.textShape !== 'none') && (
                                  <ProSlider icon="gesture" label="Curve Amount" value={activeTextEl.textCurveAmount || 0} min={-100} max={100} step={1} displayValue={`${Math.round(activeTextEl.textCurveAmount || 0)}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('textCurveAmount', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                )}

                                {/* Shadow */}
                                <View style={{ height: 8 }} />
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                  <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Shadow</Text>
                                  <TouchableOpacity onPress={() => toggleShadow(!((activeTextEl.shadowOpacity || 0) > 0))} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: (activeTextEl.shadowOpacity || 0) > 0 ? THEME.primary : '#3a3b3e', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: (activeTextEl.shadowOpacity || 0) > 0 ? 'flex-end' : 'flex-start', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 1 }} />
                                  </TouchableOpacity>
                                </View>
                                {(activeTextEl.shadowOpacity || 0) > 0 && (<>
                                  <ProSlider icon="wb-sunny" label="Blur Radius" value={activeTextEl.shadowBlur || 1} min={1} max={30} step={1} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowBlur', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                  <ProSlider icon="open-in-full" label="Distance" value={activeTextEl.shadowDistance || 0} min={0} max={50} step={1} displayValue={`${Math.round(activeTextEl.shadowDistance || 0)}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowDistance', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                  <ProSlider icon="explore" label="Light Angle" value={activeTextEl.shadowAngle || 45} min={0} max={360} step={1} displayValue={`${activeTextEl.shadowAngle || 45}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowAngle', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                  <ProSlider icon="visibility" label="Shadow Opacity" value={activeTextEl.shadowOpacity || 0} min={0} max={1} step={0.1} displayValue={`${Math.round((activeTextEl.shadowOpacity || 0) * 100)}%`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowOpacity', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                </>)}

                                {/* Stroke */}
                                <View style={{ height: 8 }} />
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                  <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Stroke</Text>
                                  <TouchableOpacity onPress={() => toggleStroke(!((activeTextEl.strokeWidth || 0) > 0))} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: (activeTextEl.strokeWidth || 0) > 0 ? THEME.primary : '#3a3b3e', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: (activeTextEl.strokeWidth || 0) > 0 ? 'flex-end' : 'flex-start', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 1 }} />
                                  </TouchableOpacity>
                                </View>
                                {(activeTextEl.strokeWidth || 0) > 0 && (<>
                                  <ProSlider icon="line-weight" label="Thickness" value={activeTextEl.strokeWidth || 2} min={1} max={8} step={0.5} displayValue={`${activeTextEl.strokeWidth || 2}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('strokeWidth', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                </>)}

                                {/* Glow */}
                                <View style={{ height: 8 }} />
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                  <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Glow</Text>
                                  <TouchableOpacity onPress={() => toggleGlow(!((activeTextEl.glowOpacity || 0) > 0))} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: (activeTextEl.glowOpacity || 0) > 0 ? THEME.primary : '#3a3b3e', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: (activeTextEl.glowOpacity || 0) > 0 ? 'flex-end' : 'flex-start', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 1 }} />
                                  </TouchableOpacity>
                                </View>
                                {(activeTextEl.glowOpacity || 0) > 0 && (<>
                                  <ProSlider icon="blur-on" label="Glow Radius" value={activeTextEl.glowRadius || 8} min={2} max={30} step={1} displayValue={`${activeTextEl.glowRadius || 8}`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('glowRadius', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                  <ProSlider icon="visibility" label="Glow Intensity" value={activeTextEl.glowOpacity || 0} min={0.1} max={1} step={0.1} displayValue={`${Math.round((activeTextEl.glowOpacity || 0) * 100)}%`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('glowOpacity', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                </>)}

                                {/* Behind Subject */}
                                <View style={{ height: 8 }} />
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <MaterialIcons name="person" size={14} color={THEME.textMuted} style={{ marginRight: 6 }} />
                                    <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Behind Subject</Text>
                                    <MaterialIcons name="star" size={10} color={THEME.primary} style={{ marginLeft: 6 }} />
                                  </View>
                                  <TouchableOpacity onPress={() => {
                                    const newVal = !activeTextEl.behindSubject;
                                    updateStyleWithHistory('behindSubject', newVal);
                                    if (newVal && (typeof activeTextEl.behindDepth !== 'number' || activeTextEl.behindDepth <= 0)) {
                                      updateStyleWithHistory('behindDepth', 1);
                                    }
                                    if (newVal && !subjectCutoutUri && bgImage) {
                                      generateSubjectCutout(bgImage);
                                    }
                                  }} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: activeTextEl.behindSubject ? THEME.primary : '#3a3b3e', justifyContent: 'center', paddingHorizontal: 2 }}>
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignSelf: activeTextEl.behindSubject ? 'flex-end' : 'flex-start', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 1 }} />
                                  </TouchableOpacity>
                                </View>
                                {activeTextEl.behindSubject && (
                                  <ProSlider
                                    icon="layers"
                                    label="Behind Depth"
                                    value={typeof activeTextEl.behindDepth === 'number' ? activeTextEl.behindDepth : 1}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    displayValue={`${Math.round(((typeof activeTextEl.behindDepth === 'number' ? activeTextEl.behindDepth : 1)) * 100)}%`}
                                    onStart={handleSliderStart}
                                    onChange={(v:number) => updateSelectedStyle('behindDepth', v)}
                                    onComplete={handleSliderComplete}
                                    onScrollLock={setPanelScrollEnabled}
                                  />
                                )}
                                {isSegmenting && <ActivityIndicator size="small" color={THEME.primary} style={{ marginBottom: 8 }} />}
                                {activeTextEl.behindSubject && subjectCutoutUri && (
                                  <TouchableOpacity onPress={openMaskEditor} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#3a3b3e' }}>
                                    <MaterialIcons name="brush" size={14} color={THEME.primary} />
                                    <Text style={{ color: THEME.textMain, fontSize: 11, fontWeight: '600' }}>Edit Subject Mask</Text>
                                  </TouchableOpacity>
                                )}
                                {activeTextEl.behindSubject && (
                                  <View style={{ marginBottom: 8 }}>
                                    <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Edge Precision</Text>
                                    <View style={{ flexDirection: 'row', gap: 6 }}>
                                      {(['soft', 'normal', 'hard'] as const).map((p) => (
                                        <TouchableOpacity
                                          key={p}
                                          onPress={() => {
                                            if (edgePrecision !== p) {
                                              setEdgePrecision(p);
                                              if (bgImage) {
                                                setSubjectCutoutUri(null);
                                                setSubjectMaskUri(null);
                                                generateSubjectCutout(bgImage);
                                              }
                                            }
                                          }}
                                          style={{ flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: edgePrecision === p ? THEME.primary : THEME.bgSurfaceHigh, alignItems: 'center', borderWidth: 1, borderColor: edgePrecision === p ? THEME.primary : '#3a3b3e' }}
                                        >
                                          <Text style={{ color: edgePrecision === p ? THEME.bgBase : THEME.textMuted, fontSize: 11, fontWeight: '600' }}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                                        </TouchableOpacity>
                                      ))}
                                    </View>
                                  </View>
                                )}

                                {/* 3D Transform */}
                                <View style={{ height: 8 }} />
                                <Text style={[styles.sectionTitle, { marginTop: 4 }]}>3D Transform {!isPro ? '✨' : ''}</Text>
                                <ProSlider icon="flip" label="Rotate X (Tilt)" value={activeTextEl.rotateX || 0} min={-90} max={90} step={1} displayValue={`${Math.round(activeTextEl.rotateX || 0)}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('rotateX', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="flip" label="Rotate Y (Swing)" value={activeTextEl.rotateY || 0} min={-90} max={90} step={1} displayValue={`${Math.round(activeTextEl.rotateY || 0)}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('rotateY', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="rotate-right" label="Rotate Z (Spin)" value={activeTextEl.rotateZ || 0} min={-180} max={180} step={1} displayValue={`${Math.round(activeTextEl.rotateZ || 0)}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('rotateZ', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                                <ProSlider icon="zoom-in" label="Scale" value={activeTextEl.scale || 1} min={0.1} max={4} step={0.05} displayValue={`${(activeTextEl.scale || 1).toFixed(2)}x`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('scale', v)} onComplete={handleSliderComplete} onScrollLock={setPanelScrollEnabled} />
                              </ScrollView> 
                            )}

                            {textSubTab === 'color' && ( 
                              <ScrollView style={styles.advancedMenu} showsVerticalScrollIndicator={false} scrollEnabled={panelScrollEnabled}>
                                <View style={styles.colorTargetRow}><TouchableOpacity style={[styles.colorTargetBtn, colorTarget === 'color' && styles.colorTargetBtnActive]} onPress={() => setColorTarget('color')}><Text style={[styles.colorTargetText, colorTarget === 'color' && styles.colorTargetTextActive]}>Text</Text></TouchableOpacity><TouchableOpacity style={[styles.colorTargetBtn, colorTarget === 'shadowColor' && styles.colorTargetBtnActive]} onPress={() => setColorTarget('shadowColor')}><Text style={[styles.colorTargetText, colorTarget === 'shadowColor' && styles.colorTargetTextActive]}>Shadow</Text></TouchableOpacity><TouchableOpacity style={[styles.colorTargetBtn, colorTarget === 'strokeColor' && styles.colorTargetBtnActive]} onPress={() => setColorTarget('strokeColor')}><Text style={[styles.colorTargetText, colorTarget === 'strokeColor' && styles.colorTargetTextActive]}>Stroke</Text></TouchableOpacity><TouchableOpacity style={[styles.colorTargetBtn, colorTarget === 'glowColor' && styles.colorTargetBtnActive]} onPress={() => setColorTarget('glowColor')}><Text style={[styles.colorTargetText, colorTarget === 'glowColor' && styles.colorTargetTextActive]}>Glow</Text></TouchableOpacity></View>
                                {/* Template line color selector */}
                                {activeTextEl.templateLines && activeTextEl.templateLines.length > 0 && colorTarget === 'color' && (
                                  <View style={{ marginBottom: 8 }}>
                                    <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 }}>SELECT LINE TO COLOR</Text>
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                                      {activeTextEl.templateLines.map((line: any, li: number) => (
                                        <TouchableOpacity key={li} onPress={() => setActiveTemplateLineIdx(li)}
                                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: activeTemplateLineIdx === li ? 'rgba(221,198,22,0.15)' : THEME.bgSurfaceHigh, borderWidth: activeTemplateLineIdx === li ? 1.5 : 1, borderColor: activeTemplateLineIdx === li ? THEME.primary : '#3a3b3e' }}>
                                          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: line.color }} />
                                          <Text style={{ color: activeTemplateLineIdx === li ? THEME.primary : THEME.textMuted, fontSize: 10, fontWeight: '600' }} numberOfLines={1}>{line.text.substring(0, 12) || `Line ${li + 1}`}</Text>
                                        </TouchableOpacity>
                                      ))}
                                    </ScrollView>
                                  </View>
                                )}
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 30, marginBottom: 8 }}>
                                  {[...colorCategories, { id: 'custom', label: 'Custom', colors: [] }, ...(colorTarget === 'color' ? [{ id: 'customGrad', label: '🎨 Custom Gradient', colors: [] }] : [])].map(cat => (
                                    <TouchableOpacity key={cat.id} onPress={() => { gatedSetColorCategory(cat.id); }} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: colorCategoryId === cat.id ? THEME.primary : THEME.bgSurfaceHigh, marginRight: 6, flexDirection: 'row', alignItems: 'center' }}>
                                      <Text style={{ color: colorCategoryId === cat.id ? THEME.bgBase : THEME.textMuted, fontSize: 11, fontWeight: '600' }}>{cat.label}{(cat.id === 'gradient' || cat.id === 'custom' || cat.id === 'customGrad') && !isPro ? ' ✨' : ''}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </ScrollView>
                                {colorCategoryId === 'customGrad' ? (
                                  <View style={{ gap: 8 }}>
                                    <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 2 }}>Custom Gradient</Text>
                                    <View style={{ height: 44, borderRadius: 10, overflow: 'hidden', borderWidth: 1.5, borderColor: THEME.bgSurfaceHigh }}>
                                      <LinearGradient colors={[customGradColor1, customGradColor2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
                                    </View>
                                    <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600', marginTop: 4 }}>Color 1</Text>
                                    <ProSlider icon="palette" label="Hue 1" value={customGradHue1} min={0} max={359} step={1} displayValue={`${Math.round(customGradHue1)}°`} onChange={(v: number) => { setCustomGradHue1(v); const c = hsvToHex(v, 0.85, 0.95); setCustomGradColor1(c); updateStyleWithHistory(colorTarget, `gradient:${c},${customGradColor2}`); }} onScrollLock={setPanelScrollEnabled} />
                                    <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: '600', marginTop: 4 }}>Color 2</Text>
                                    <ProSlider icon="palette" label="Hue 2" value={customGradHue2} min={0} max={359} step={1} displayValue={`${Math.round(customGradHue2)}°`} onChange={(v: number) => { setCustomGradHue2(v); const c = hsvToHex(v, 0.85, 0.95); setCustomGradColor2(c); updateStyleWithHistory(colorTarget, `gradient:${customGradColor1},${c}`); }} onScrollLock={setPanelScrollEnabled} />
                                    <TouchableOpacity onPress={() => updateStyleWithHistory(colorTarget, `gradient:${customGradColor1},${customGradColor2}`)} style={{ backgroundColor: THEME.primary, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 4 }}>
                                      <Text style={{ color: THEME.bgBase, fontSize: 12, fontWeight: '700' }}>Apply Gradient</Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : colorCategoryId !== 'custom' ? (
                                  <View style={styles.colorPaletteGrid}>{(colorCategories.find(c => c.id === colorCategoryId)?.colors || COLOR_PALETTE).map((color) => { 
                                    const isGradient = color.startsWith('gradient:');
                                    if (isGradient && colorTarget !== 'color') return null;
                                    const isActive = activeTextEl?.[colorTarget] === color;
                                    if (isGradient) {
                                      const [c1, c2] = color.replace('gradient:', '').split(',');
                                      return (
                                        <TouchableOpacity key={color} style={[{ width: 44, height: 44, borderRadius: 22, borderWidth: 2.5, borderColor: isActive ? THEME.primary : THEME.bgSurfaceHigh, overflow: 'hidden', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3 }]} onPress={() => applyColorTarget(color)}>
                                          <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                                          {isActive && <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' }}><MaterialIcons name="check" size={18} color="#fff" /></View>}
                                        </TouchableOpacity>
                                      );
                                    }
                                    return ( <TouchableOpacity key={color} style={[styles.colorGridSwatch, { backgroundColor: color, borderColor: isActive ? THEME.textMain : 'transparent' }]} onPress={() => applyColorTarget(color)} /> ); 
                                  })}</View>
                                ) : (
                                  <View style={{ gap: 6 }}>
                                    <View style={{ height: 36, borderRadius: 8, backgroundColor: hsvToHex(customHue, customSat, customVal), borderWidth: 1, borderColor: THEME.bgSurfaceHigh }} />
                                    <ProSlider icon="palette" label="Hue" value={customHue} min={0} max={359} step={1} displayValue={`${Math.round(customHue)}°`} onChange={(v: number) => { setCustomHue(v); applyColorTarget(hsvToHex(v, customSat, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                    <ProSlider icon="opacity" label="Saturation" value={customSat * 100} min={0} max={100} step={1} displayValue={`${Math.round(customSat * 100)}%`} onChange={(v: number) => { setCustomSat(v / 100); applyColorTarget(hsvToHex(customHue, v / 100, customVal)); }} onScrollLock={setPanelScrollEnabled} />
                                    <ProSlider icon="brightness-6" label="Brightness" value={customVal * 100} min={0} max={100} step={1} displayValue={`${Math.round(customVal * 100)}%`} onChange={(v: number) => { setCustomVal(v / 100); applyColorTarget(hsvToHex(customHue, customSat, v / 100)); }} onScrollLock={setPanelScrollEnabled} />
                                  </View>
                                )}
                                {/* Gradient Angle control - show when active color is a gradient */}
                                {colorTarget === 'color' && activeTextEl?.color?.startsWith('gradient:') && (
                                  <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: THEME.bgSurfaceHigh }}>
                                    <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>Gradient Direction</Text>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                                      {[
                                        { label: '→', angle: 0 }, { label: '↘', angle: 45 }, { label: '↓', angle: 90 }, { label: '↙', angle: 135 },
                                        { label: '←', angle: 180 }, { label: '↖', angle: 225 }, { label: '↑', angle: 270 }, { label: '↗', angle: 315 },
                                      ].map(d => (
                                        <TouchableOpacity key={d.angle} onPress={() => updateStyleWithHistory('gradientAngle', d.angle)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: (activeTextEl?.gradientAngle ?? 45) === d.angle ? THEME.primary : THEME.bgSurfaceHigh, justifyContent: 'center', alignItems: 'center' }}>
                                          <Text style={{ color: (activeTextEl?.gradientAngle ?? 45) === d.angle ? THEME.bgBase : THEME.textMain, fontSize: 16, fontWeight: '700' }}>{d.label}</Text>
                                        </TouchableOpacity>
                                      ))}
                                    </View>
                                    <ProSlider icon="rotate-right" label="Angle" value={activeTextEl?.gradientAngle ?? 45} min={0} max={360} step={1} displayValue={`${Math.round(activeTextEl?.gradientAngle ?? 45)}°`} onChange={(v: number) => updateStyleWithHistory('gradientAngle', v)} onScrollLock={setPanelScrollEnabled} />
                                  </View>
                                )}
                              </ScrollView> 
                            )}
                          </View> 
                        )}
                      </View> 
                    )}
                  </View>
                </>
              )}
            </View>
          </View>

          {isTyping && ( 
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.textInputOverlay, { paddingHorizontal: safeLeft }]}>
              <View style={[styles.textOverlayHeader, { marginTop: safeTop + 16 }]}><TouchableOpacity onPress={() => setIsTyping(false)}><Text style={styles.textOverlayCancel}>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={selectedId ? () => { commitHistory(prev => prev.map(el => el.id === selectedId ? { ...el, content: currentText } : el)); setIsTyping(false); } : commitText} style={styles.doneBtn}><Text style={styles.textOverlayDone}>Apply</Text></TouchableOpacity></View>
              {/* WYSIWYG FIX: TEXT INPUT NOW DYNAMICALLY INHERITS THE ACTIVE FONT STYLE */}
              <TextInput 
                style={[
                  styles.mainTextInput, 
                  { 
                    color: activeTextEl ? activeTextEl.color : '#FFFFFF',
                    fontFamily: activeActualFont,
                    textAlign: activeTextEl ? (activeTextEl.textAlign as any) : 'center',
                    fontStyle: activeTextEl && activeTextEl.isItalic ? 'italic' : 'normal',
                    textDecorationLine: activeTextEl && activeTextEl.isUnderline ? 'underline' : 'none'
                  }
                ]} 
                value={currentText} 
                onChangeText={setCurrentText} 
                placeholder=" ಪಠ್ಯ ಸೇರಿಸಿ..." 
                placeholderTextColor="rgba(255,255,255,0.2)" 
                autoFocus={true} 
                multiline={true} 
              />
            </KeyboardAvoidingView> 
          )}
          
          {isExporting && (
            <View style={[styles.exportOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
              {/* Printer body */}
              <View style={{ alignItems: 'center', marginBottom: 20 }}>
                {/* Printer top slot */}
                <View style={{ width: 180, height: 8, backgroundColor: '#2a2b2e', borderTopLeftRadius: 8, borderTopRightRadius: 8, zIndex: 5 }} />
                <View style={{ width: 200, height: 50, backgroundColor: '#1e1f22', borderRadius: 4, justifyContent: 'center', alignItems: 'center', zIndex: 4, borderWidth: 1, borderColor: '#3a3b3e' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Animated.View style={{ transform: [{ rotate: exportSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
                      <MaterialIcons name="settings" size={16} color={THEME.primary} />
                    </Animated.View>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' }} />
                    <Animated.View style={{ transform: [{ rotate: exportSpin.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] }) }] }}>
                      <MaterialIcons name="settings" size={12} color="#666" />
                    </Animated.View>
                  </View>
                </View>

                {/* Paper coming out - photo printing effect */}
                <View style={{ width: 160, overflow: 'hidden', zIndex: 3, marginTop: -2 }}>
                  <Animated.View style={{ 
                    height: exportProgress.interpolate({ inputRange: [0, 100], outputRange: [0, 200] }),
                    overflow: 'hidden', backgroundColor: '#FFFFFF', borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
                    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8
                  }}>
                    {/* Photo printing reveal */}
                    <View style={{ width: 160, height: 200, padding: 6 }}>
                      <View style={{ flex: 1, borderRadius: 2, overflow: 'hidden', backgroundColor: '#000' }}>
                        {printPreviewUri && <Image source={{ uri: printPreviewUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
                        {/* Color overlay that fades as it "develops" */}
                        <Animated.View style={{ 
                          ...StyleSheet.absoluteFillObject, 
                          backgroundColor: '#fff',
                          opacity: exportProgress.interpolate({ inputRange: [0, 40, 80, 100], outputRange: [0.9, 0.5, 0.15, 0] })
                        }} />
                      </View>
                    </View>
                    {/* Acchu branding strip on the photo */}
                    <View style={{ position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' }}>
                      <Text style={{ fontSize: 6, color: 'rgba(0,0,0,0.15)', fontWeight: '600', letterSpacing: 1.5 }}>ACCHU KANNADA</Text>
                    </View>
                  </Animated.View>
                </View>

                {/* Printer bottom tray */}
                <View style={{ width: 190, height: 12, backgroundColor: '#1e1f22', borderBottomLeftRadius: 8, borderBottomRightRadius: 8, marginTop: -2, zIndex: 2, borderWidth: 1, borderTopWidth: 0, borderColor: '#3a3b3e' }} />
              </View>

              {/* Progress bar */}
              <View style={{ width: 200, height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
                <Animated.View style={{ height: 3, borderRadius: 2, backgroundColor: THEME.primary, width: exportProgress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }} />
              </View>
              {/* Percentage */}
              <ExportPercentText progress={exportProgress} />
              {/* Stage text */}
              <ExportStageText stage={exportStage} />

              {/* Ad banner at bottom for non-pro users */}
              {!isPro && (
                <View style={{ position: 'absolute', bottom: safeBottom + 4, left: 0, right: 0, alignItems: 'center' }}>
                  <BannerAd
                    unitId={ADMOB_BANNER_ID}
                    size={BannerAdSize.BANNER}
                    requestOptions={{ requestNonPersonalizedAdsOnly: false }}
                  />
                </View>
              )}
              {isPro && (
                <Text style={{ position: 'absolute', bottom: safeBottom + 30, color: THEME.textMuted, fontSize: 11, letterSpacing: 0.5 }}>ಅಚ್ಚು ಕನ್ನಡ · Acchu Kannada Pro</Text>
              )}
            </View>
          )}

          {exportUri && (
            <View style={styles.exportOverlay}>
              <View style={[styles.exportHeader, { paddingTop: safeTop + 8 }]}>
                <TouchableOpacity onPress={() => { setExportUri(null); setForceColorMatrix(false); setGlCaptureUri(null); }}><MaterialIcons name="close" size={28} color={THEME.textMain} /></TouchableOpacity>
                <Text style={styles.exportTitle}>Your Creation</Text>
                <View style={{width: 28}} />
              </View>
              
              <Image source={{ uri: exportUri }} style={styles.exportPreviewImage} resizeMode="contain" />
              
              <View style={[styles.exportActionContainer, { paddingBottom: safeBottom + 20 }]}>
                <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Export Format</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {(['png', 'jpg', 'pdf'] as const).map(fmt => {
                    const isPdf = fmt === 'pdf';
                    const isLocked = isPdf && !isPro;
                    return (
                      <TouchableOpacity
                        key={fmt}
                        onPress={() => {
                          if (isLocked) {
                            requirePro();
                          } else {
                            setExportFormat(fmt);
                          }
                        }}
                        style={{
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          paddingVertical: 10,
                          borderRadius: 10,
                          backgroundColor: exportFormat === fmt ? THEME.primary : THEME.bgSurfaceHigh,
                          opacity: isLocked ? 0.5 : 1,
                        }}
                      >
                        <Text style={{ color: exportFormat === fmt ? THEME.bgBase : THEME.textMuted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' }}>{fmt}</Text>
                        {isLocked && (
                          <MaterialIcons name="lock" size={16} color={THEME.textMuted} style={{ marginLeft: 6 }} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {exportFormat === 'pdf' ? (
                  <>
                    <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>PDF Quality</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                      {([
                        { label: 'Screen', value: 'screen' as const, desc: '72 DPI' },
                        { label: 'Print', value: 'print' as const, desc: '300 DPI' }
                      ]).map(q => (
                        <TouchableOpacity
                          key={q.label}
                          onPress={() => setPdfQuality(q.value)}
                          style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: pdfQuality === q.value ? THEME.primary : THEME.bgSurfaceHigh }}
                        >
                          <Text style={{ color: pdfQuality === q.value ? THEME.bgBase : THEME.textMuted, fontSize: 12, fontWeight: '700' }}>{q.label}</Text>
                          <Text style={{ color: pdfQuality === q.value ? THEME.bgBase : THEME.textMuted, fontSize: 10, marginTop: 2 }}>{q.desc}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Export Quality</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                      {([{ label: 'Normal', value: 0.5 }, { label: 'Pro', value: 0.75 }, { label: 'Supreme', value: 1.0 }] as const).map(q => {
                        const qualityLocked = q.value > 0.5 && !isPro;
                        return (
                        <TouchableOpacity key={q.label} onPress={() => { if (qualityLocked) { requirePro(); return; } setExportQuality(q.value as 0.5 | 0.75 | 1.0); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: exportQuality === q.value ? THEME.primary : THEME.bgSurfaceHigh, opacity: qualityLocked ? 0.6 : 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text style={{ color: exportQuality === q.value ? THEME.bgBase : THEME.textMain, fontSize: 12, fontWeight: '700' }}>{q.label}</Text>
                            {qualityLocked && <MaterialIcons name="lock" size={12} color={THEME.textMuted} />}
                          </View>
                          <Text style={{ color: exportQuality === q.value ? THEME.bgBase : THEME.textMuted, fontSize: 10, marginTop: 2 }}>{Math.round(q.value * 100)}%</Text>
                        </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
                <TouchableOpacity style={styles.exportPrimaryBtn} onPress={saveToGallery}>
                  <MaterialIcons name={exportFormat === 'pdf' ? 'picture-as-pdf' : 'save'} size={20} color={THEME.bgBase} style={{marginRight: 10}} />
                  <Text style={styles.exportPrimaryBtnText}>{exportFormat === 'pdf' ? 'Export as PDF' : 'Save to Gallery'}</Text>
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.exportSecondaryBtn} onPress={shareImage}>
                  <MaterialIcons name="share" size={20} color={THEME.textMain} style={{marginRight: 10}} />
                  <Text style={styles.exportSecondaryBtnText}>Share Image</Text>
                </TouchableOpacity>
                
                <View style={styles.exportHashtagBox}>
                  <Text style={styles.exportHashtagText}>Tag us or use <Text style={{color: THEME.primary}}>#acchukannada</Text></Text>
                  <Text style={styles.exportHashtagKannada}>ಕನ್ನಡ ಬಳಸಿ ಕನ್ನಡ ಉಳಿಸಿ</Text>
                </View>
              </View>
            </View>
          )}
        </>
      )}

      {/* ── Fullscreen Curve Editor Modal ── */}
      <Modal visible={showCurveEditor} transparent animationType="slide" onRequestClose={() => setShowCurveEditor(false)} statusBarTranslucent>
        {(() => {
          const CURVE_SIZE = SCREEN_W - 32;
          const TOUCH_RADIUS = 0.07;
          const channels = [
            { id: 'master' as const, label: 'RGB', color: '#FFFFFF' },
            { id: 'red' as const, label: 'Red', color: '#FF6B6B' },
            { id: 'green' as const, label: 'Green', color: '#51CF66' },
            { id: 'blue' as const, label: 'Blue', color: '#339AF0' },
          ];
          const cpState = activeCurveChannel === 'master' ? curveCpMaster : activeCurveChannel === 'red' ? curveCpR : activeCurveChannel === 'green' ? curveCpG : curveCpB;
          const setCpState = activeCurveChannel === 'master' ? setCurveCpMaster : activeCurveChannel === 'red' ? setCurveCpR : activeCurveChannel === 'green' ? setCurveCpG : setCurveCpB;
          const setLut = activeCurveChannel === 'master' ? setCurveMaster : activeCurveChannel === 'red' ? setCurveR : activeCurveChannel === 'green' ? setCurveG : setCurveB;
          const chColor = channels.find(c => c.id === activeCurveChannel)?.color || '#FFF';

          // SVG paths for ALL channels (shown simultaneously)
          const allPaths = [
            { id: 'red', path: smoothCurvePath(curveCpR, CURVE_SIZE), color: '#FF6B6B' },
            { id: 'green', path: smoothCurvePath(curveCpG, CURVE_SIZE), color: '#51CF66' },
            { id: 'blue', path: smoothCurvePath(curveCpB, CURVE_SIZE), color: '#339AF0' },
            { id: 'master', path: smoothCurvePath(curveCpMaster, CURVE_SIZE), color: '#FFFFFF' },
          ];

          // Simulated histogram bars (32 bins)
          const histBars = [0.08, 0.12, 0.18, 0.25, 0.35, 0.48, 0.55, 0.62, 0.72, 0.78, 0.85, 0.90, 0.95, 0.88, 0.80, 0.72, 0.65, 0.58, 0.52, 0.48, 0.55, 0.60, 0.65, 0.58, 0.50, 0.42, 0.35, 0.28, 0.22, 0.15, 0.10, 0.06];

          const updateLutFromCps = (cps: { x: number; y: number }[]) => {
            setLut(monotoneInterpolateLUT(cps));
          };

          const handleCurveGrant = (e: any) => {
            const { locationX, locationY } = e.nativeEvent;
            const normX = Math.max(0, Math.min(1, locationX / CURVE_SIZE));
            const normY = Math.max(0, Math.min(1, 1 - locationY / CURVE_SIZE));
            let nearest = -1;
            let minDist = Infinity;
            cpState.forEach((pt: { x: number; y: number }, idx: number) => {
              const dx = normX - pt.x;
              const dy = normY - pt.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < minDist) { minDist = dist; nearest = idx; }
            });
            if (minDist < TOUCH_RADIUS) {
              setCurveDragIdx(nearest);
              const newCps = [...cpState];
              if (nearest > 0 && nearest < cpState.length - 1) {
                newCps[nearest] = { x: normX, y: normY };
              } else {
                newCps[nearest] = { x: cpState[nearest].x, y: normY };
              }
              setCpState(newCps);
              updateLutFromCps(newCps);
            } else {
              const newPt = { x: normX, y: normY };
              const newCps = [...cpState, newPt].sort((a, b) => a.x - b.x);
              const newIdx = newCps.findIndex(p => p === newPt);
              setCpState(newCps);
              setCurveDragIdx(newIdx);
              updateLutFromCps(newCps);
            }
          };

          const handleCurveMove = (e: any) => {
            if (curveDragIdx === null) return;
            const { locationX, locationY } = e.nativeEvent;
            const normX = Math.max(0, Math.min(1, locationX / CURVE_SIZE));
            const normY = Math.max(0, Math.min(1, 1 - locationY / CURVE_SIZE));
            const newCps = [...cpState];
            const idx = curveDragIdx;
            if (idx < 0 || idx >= newCps.length) return;
            if (idx === 0) {
              newCps[idx] = { x: 0, y: normY };
            } else if (idx === newCps.length - 1) {
              newCps[idx] = { x: 1, y: normY };
            } else {
              const minX = newCps[idx - 1].x + 0.02;
              const maxX = newCps[idx + 1].x - 0.02;
              newCps[idx] = { x: Math.max(minX, Math.min(maxX, normX)), y: normY };
            }
            setCpState(newCps);
            updateLutFromCps(newCps);
          };

          const handleCurveRelease = (e: any) => {
            if (curveDragIdx !== null && curveDragIdx > 0 && curveDragIdx < cpState.length - 1) {
              const { locationX, locationY } = e.nativeEvent;
              if (locationX < -20 || locationX > CURVE_SIZE + 20 || locationY < -20 || locationY > CURVE_SIZE + 20) {
                const newCps = cpState.filter((_: any, i: number) => i !== curveDragIdx);
                setCpState(newCps);
                updateLutFromCps(newCps);
              }
            }
            setCurveDragIdx(null);
          };

          return (
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              {/* Live editing preview — renders full GL pipeline with live curve updates */}
              {bgImage ? (() => {
                const imgAspect = imgDim.w / Math.max(imgDim.h, 1);
                const screenAspect = SCREEN_W / SCREEN_H;
                const fitW = imgAspect > screenAspect ? SCREEN_W : Math.round(SCREEN_H * imgAspect);
                const fitH = imgAspect > screenAspect ? Math.round(SCREEN_W / imgAspect) : SCREEN_H;
                return (
                  <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
                    <GLImageEditor
                      src={bgImage}
                      width={fitW}
                      height={fitH}
                    uniforms={{
                      brightness: imgAdj.brightness,
                      contrast: imgAdj.contrast,
                      highlights: imgAdj.highlights,
                      shadows: imgAdj.shadows,
                      saturation: imgAdj.saturation,
                      vibrance: imgAdj.vibrance,
                      temp: imgAdj.temp,
                      tint: imgAdj.tint,
                      fade: imgAdj.fade,
                      dehaze: imgAdj.dehaze,
                      clarity: imgAdj.clarity,
                      sharpness: imgAdj.sharpness,
                      grain: 0,
                      grainSize: 0,
                      grainRoughness: 0,
                      grainColor: 0,
                      filterStrength: filterStrength,
                      filterMatrix: activeFilter.matrix,
                      hslRed: hslValues?.Red || [0,0,0],
                      hslOrange: hslValues?.Orange || [0,0,0],
                      hslYellow: hslValues?.Yellow || [0,0,0],
                      hslGreen: hslValues?.Green || [0,0,0],
                      hslAqua: hslValues?.Aqua || [0,0,0],
                      hslBlue: hslValues?.Blue || [0,0,0],
                      hslPurple: hslValues?.Purple || [0,0,0],
                      hslMagenta: hslValues?.Magenta || [0,0,0],
                      curveR,
                      curveG,
                      curveB,
                      curveMaster,
                    }}
                    />
                  </View>
                );
              })() : null}

              {/* Curve graph area - overlaid on image */}
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: safeTop }}>
                <View
                  style={{ width: CURVE_SIZE, height: CURVE_SIZE, backgroundColor: 'rgba(128,128,128,0.15)', borderRadius: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={handleCurveGrant}
                  onResponderMove={handleCurveMove}
                  onResponderRelease={handleCurveRelease}
                >
                  <Svg width={CURVE_SIZE} height={CURVE_SIZE}>
                    {/* Histogram background */}
                    {histBars.map((h, i) => {
                      const barW = CURVE_SIZE / histBars.length;
                      const barH = h * CURVE_SIZE * 0.85;
                      return (
                        <SvgRect
                          key={`hist${i}`}
                          x={i * barW}
                          y={CURVE_SIZE - barH}
                          width={barW}
                          height={barH}
                          fill="rgba(255,255,255,0.08)"
                        />
                      );
                    })}

                    {/* Grid lines */}
                    {[1, 2, 3].map(i => (
                      <Line key={`gv${i}`} x1={(i / 4) * CURVE_SIZE} y1={0} x2={(i / 4) * CURVE_SIZE} y2={CURVE_SIZE} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
                    ))}
                    {[1, 2, 3].map(i => (
                      <Line key={`gh${i}`} x1={0} y1={(i / 4) * CURVE_SIZE} x2={CURVE_SIZE} y2={(i / 4) * CURVE_SIZE} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
                    ))}

                    {/* Diagonal reference */}
                    <Line x1={0} y1={CURVE_SIZE} x2={CURVE_SIZE} y2={0} stroke="rgba(255,255,255,0.12)" strokeWidth={0.5} />

                    {/* ALL channel curves drawn simultaneously */}
                    {allPaths.filter(p => p.id !== activeCurveChannel).map(p => (
                      <Path key={p.id} d={p.path} fill="none" stroke={p.color} strokeWidth={1.5} strokeLinecap="round" opacity={0.4} />
                    ))}
                    {/* Active channel curve on top */}
                    {allPaths.filter(p => p.id === activeCurveChannel).map(p => (
                      <Path key={p.id} d={p.path} fill="none" stroke={p.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                    ))}

                    {/* Control points for active channel */}
                    {cpState.map((pt: { x: number; y: number }, idx: number) => {
                      const cx = pt.x * CURVE_SIZE;
                      const cy = (1 - pt.y) * CURVE_SIZE;
                      const isActive = curveDragIdx === idx;
                      return (
                        <SvgCircle key={idx} cx={cx} cy={cy} r={isActive ? 10 : 7} fill={isActive ? chColor : '#fff'} stroke={chColor} strokeWidth={2} opacity={isActive ? 1 : 0.85} />
                      );
                    })}
                  </Svg>
                </View>
              </View>

              {/* Bottom toolbar */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 24, paddingTop: 12, paddingBottom: safeBottom + 12, backgroundColor: 'rgba(0,0,0,0.6)' }}>
                {/* Close */}
                <TouchableOpacity onPress={() => setShowCurveEditor(false)} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name="close" size={26} color="#fff" />
                </TouchableOpacity>

                {/* Channel: RGB / Contrast */}
                <TouchableOpacity onPress={() => {
                  const order: ('master' | 'red' | 'green' | 'blue')[] = ['master', 'red', 'green', 'blue'];
                  const idx = order.indexOf(activeCurveChannel);
                  setActiveCurveChannel(order[(idx + 1) % order.length]);
                }} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name="contrast" size={26} color={activeCurveChannel !== 'master' ? chColor : '#fff'} />
                </TouchableOpacity>

                {/* Channel indicator / visibility */}
                <TouchableOpacity onPress={() => setActiveCurveChannel('master')} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name="visibility" size={26} color={activeCurveChannel === 'master' ? '#4DA6FF' : '#fff'} />
                </TouchableOpacity>

                {/* Reset */}
                <TouchableOpacity onPress={() => {
                  const def = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
                  setCurveCpR([...def]); setCurveCpG([...def]); setCurveCpB([...def]); setCurveCpMaster([...def]);
                  setCurveR([...IDENTITY_CURVE_17]); setCurveG([...IDENTITY_CURVE_17]); setCurveB([...IDENTITY_CURVE_17]); setCurveMaster([...IDENTITY_CURVE_17]);
                }} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name="equalizer" size={26} color="#fff" />
                </TouchableOpacity>

                {/* Apply */}
                <TouchableOpacity onPress={() => setShowCurveEditor(false)} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}>
                  <MaterialIcons name="check" size={26} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}
      </Modal>

      <Modal
        visible={saveSuccessVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSaveSuccessVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setSaveSuccessVisible(false)}>
          <View style={proStyles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[proStyles.modalCard, { maxWidth: 340 }]}>
                <View style={[proStyles.iconWrap, { backgroundColor: 'rgba(221, 198, 22, 0.15)' }]}>
                  <MaterialIcons name="check-circle" size={32} color={THEME.primary} />
                </View>
                <Text style={[proStyles.title, { fontSize: 22 }]}>{exportConfig?.saveSuccess?.title || 'Saved! 🎉'}</Text>
                <Text style={[proStyles.desc, { marginBottom: 16 }]}>{exportConfig?.saveSuccess?.description || 'Image beautifully saved to your gallery'}</Text>
                
                <View style={{ backgroundColor: THEME.bgBase, borderRadius: 16, padding: 16, width: '100%', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(221, 198, 22, 0.2)' }}>
                  <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: '500', marginBottom: 8, letterSpacing: 0.5 }}>{exportConfig?.saveSuccess?.socialPrompt || 'Tag us on social media'}</Text>
                  <Text style={{ color: THEME.primary, fontSize: 18, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 }}>{exportConfig?.saveSuccess?.socialHandle || '@acchukannada'}</Text>
                  <View style={{ width: 40, height: 1, backgroundColor: 'rgba(221, 198, 22, 0.3)', marginBottom: 10 }} />
                  <Text style={{ color: THEME.textMain, fontSize: 22, fontFamily: 'Padyakke', textAlign: 'center', letterSpacing: 1 }}>{exportConfig?.saveSuccess?.kannadaText || 'ಜೈ ಕನ್ನಡ'}</Text>
                  <Text style={{ color: THEME.textMuted, fontSize: 11, fontFamily: 'ATSSmooth', marginTop: 4, letterSpacing: 0.8 }}>{exportConfig?.saveSuccess?.kannadaSubtext || 'jai kannada'}</Text>
                </View>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                  <Text style={{ color: THEME.textMuted, fontSize: 11 }}>Use </Text>
                  <Text style={{ color: THEME.primary, fontSize: 12, fontWeight: '700' }}>{exportConfig?.saveSuccess?.hashtag || '#acchukannada'}</Text>
                </View>
                
                <TouchableOpacity style={proStyles.btn} onPress={() => setSaveSuccessVisible(false)}>
                  <Text style={proStyles.btnText}>{exportConfig?.saveSuccess?.doneButtonText || 'Done'}</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Save Preset Modal ── */}
      <Modal visible={showSavePresetModal} transparent animationType="fade" onRequestClose={() => setShowSavePresetModal(false)}>
        <TouchableWithoutFeedback onPress={() => setShowSavePresetModal(false)}>
          <View style={proStyles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[proStyles.modalCard, { maxWidth: 320, padding: 24 }]}>
                <MaterialIcons name="bookmark" size={28} color={THEME.primary} style={{ marginBottom: 8 }} />
                <Text style={[proStyles.title, { fontSize: 18 }]}>Save Preset</Text>
                <Text style={[proStyles.desc, { marginBottom: 14 }]}>Save your current adjustments, filter, HSL and curves settings as a reusable preset.</Text>
                <TextInput
                  value={presetNameInput}
                  onChangeText={setPresetNameInput}
                  placeholder="Preset name..."
                  placeholderTextColor={THEME.textMuted}
                  style={{ backgroundColor: THEME.bgSurfaceHigh, color: THEME.textMain, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, marginBottom: 14, borderWidth: 1.5, borderColor: THEME.primary + '40' }}
                  maxLength={30}
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => setShowSavePresetModal(false)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: THEME.bgSurfaceHigh, alignItems: 'center' }}>
                    <Text style={{ color: THEME.textMuted, fontSize: 13, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { saveUserPreset(presetNameInput); setPresetNameInput(''); setShowSavePresetModal(false); }} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: THEME.primary, alignItems: 'center' }}>
                    <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>


      {/* ── Paywall Modal ── */}
      <Modal
        visible={paywallVisible || crownModalVisible}
        transparent={false}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => { setPaywallVisible(false); setCrownModalVisible(false); setProWelcomeVisible(false); setTextSubTab(prevTextSubTab.current); if (prevPackId.current) setActivePackId(prevPackId.current); }}
      >
        {(() => {
          const REMOTE_PLANS = paywallConfig?.plans;
          const MAIN_PLANS = REMOTE_PLANS
            ? REMOTE_PLANS.filter((p: any) => p.id !== 'lifetime')
            : [
              { id: 'weekly',  label: 'ಸಾಪ್ತಾಹಿಕ', price: '₹29',  per: '/ವಾರಕ್ಕೆ',  billing: 'ಒಮ್ಮೆ ಮಾತ್ರ', badge: null },
              { id: 'monthly', label: 'ಮಾಸಿಕ',    price: '₹59',  per: '/ತಿಂಗಳಿಗೆ', billing: 'ಪ್ರತಿ ತಿಂಗಳು ಬಿಲ್ ಮಾಡಲಾಗುತ್ತದೆ', badge: 'ಜನಪ್ರಿಯ' },
              { id: 'yearly',  label: 'ವಾರ್ಷಿಕ',  price: '₹499', per: '/ವರ್ಷಕ್ಕೆ', billing: 'ಪ್ರತಿ ವರ್ಷ ಬಿಲ್ ಮಾಡಲಾಗುತ್ತದೆ', badge: 'ಅತ್ಯುತ್ತಮ ಮೌಲ್ಯ' },
            ];
          const EXTRA_PLANS = REMOTE_PLANS
            ? REMOTE_PLANS.filter((p: any) => p.id === 'lifetime')
            : [
              { id: 'lifetime', label: 'ಜೀವಿತಾವಧಿ ಸುಪ್ರೀಮ್', price: '₹4999', per: '',            billing: 'ಒಮ್ಮೆ ಮಾತ್ರ · ಶಾಶ್ವತವಾಗಿ' },
            ];
          const ALL_PLANS = [...MAIN_PLANS, ...EXTRA_PLANS];
          const selectedPlanData = ALL_PLANS.find(p => p.id === selectedPlan) || MAIN_PLANS[2] || MAIN_PLANS[0];
          const closePaywall = () => { setPaywallVisible(false); setCrownModalVisible(false); setProWelcomeVisible(false); setTextSubTab(prevTextSubTab.current); if (prevPackId.current) setActivePackId(prevPackId.current); };
          const FEATURES: { icon: any; label: string; sub: string }[] = paywallConfig?.features || [
            { icon: 'palette',      label: 'ಎಲ್ಲಾ ಪ್ರೀಮಿಯಂ ಫಿಲ್ಟರ್‌ಗಳು',           sub: '50+ ಸಿನಿಮ್ಯಾಟಿಕ್ ಫಿಲ್ಮ್ ಲುಕ್‌ಗಳು' },
            { icon: 'tune',         label: 'ಸುಧಾರಿತ ಹೊಂದಾಣಿಕೆಗಳು',                sub: 'ಕರ್ವ್ಸ್, HSL, ಕ್ಲಾರಿಟಿ ಮತ್ತು ಇನ್ನಷ್ಟು' },
            { icon: 'person',       label: 'ಸಬ್ಜೆಕ್ಟ್ ಸೆಗ್ಮೆಂಟೇಶನ್',               sub: 'ಸಬ್ಜೆಕ್ಟ್ ಹಿಂದಿರುವ ಟೆಕ್ಸ್ಟ್, ಕಟ್‌ಔಟ್‌ಗಳು' },
            { icon: 'text-fields',  label: 'ಪ್ರೀಮಿಯಂ ಫಾಂಟ್‌ಗಳು ಮತ್ತು ಸ್ಟಿಕ್ಕರ್‌ಗಳು', sub: 'ವಿಶೇಷ ಪ್ಯಾಕ್‌ಗಳು, ಗ್ರೇಡಿಯಂಟ್‌ಗಳು' },
            { icon: 'photo-camera', label: 'ಲೈವ್ ಫಿಲ್ಟರ್‌ಗಳೊಂದಿಗೆ ಕ್ಯಾಮೆರಾ',      sub: 'ನೈಜ ಸಮಯದಲ್ಲಿ ಶೂಟ್ ಮತ್ತು ಸಂಪಾದಿಸಿ' },
            { icon: 'high-quality', label: 'HD ಎಕ್ಸ್‌ಪೋರ್ಟ್ · ವಾಟರ್‌ಮಾರ್ಕ್ ಇಲ್ಲ',     sub: '4K ವರೆಗೆ, PNG ಮತ್ತು PDF' },
          ];

          // After purchase: show celebration/welcome screen
          if (proWelcomeVisible) {
            return (
              <ProWelcomeScreen
                purchasedPlanId={purchasedPlanId}
                allPlans={ALL_PLANS}
                paywallConfig={paywallConfig}
                celebrationAnim={celebrationAnim}
                safeTop={safeTop}
                safeBottom={safeBottom}
                onExplore={closePaywall}
                onUpgrade={(planId) => {
                  setSelectedPlan(planId);
                  setProWelcomeVisible(false);
                }}
              />
            );
          }
          return (
            <View style={{ flex: 1, backgroundColor: '#0a0a0c' }}>
              {/* ── HERO IMAGE (top ~28% of screen) ── */}
              <View style={{ height: height * 0.28, width: '100%', overflow: 'hidden', borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
                {bgImage ? (
                  <Image source={{ uri: bgImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <LinearGradient colors={['#3d3708', '#18191B', '#0a0a0c']} style={StyleSheet.absoluteFill} />
                )}
                {/* Dark gradient overlay */}
                <LinearGradient colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.55)', '#0a0a0c']} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />

                {/* App logo centered on hero */}
                <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }} pointerEvents="none">
                  <View style={{ width: 76, height: 76, borderRadius: 22, backgroundColor: 'rgba(10,10,12,0.45)', borderWidth: 1, borderColor: 'rgba(221,198,22,0.35)', justifyContent: 'center', alignItems: 'center', shadowColor: THEME.primary, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
                    <Image source={{ uri: SPLASH_LOGO_URL }} style={{ width: 58, height: 58 }} resizeMode="contain" />
                  </View>
                </View>

                {/* Close button */}
                <TouchableOpacity
                  onPress={closePaywall}
                  style={{ position: 'absolute', top: safeTop + 10, left: 16, zIndex: 20, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}
                >
                  <MaterialIcons name="close" size={18} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* ── SINGLE-PAGE CONTENT (no scrolling) ── */}
              <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 6, paddingBottom: safeBottom + 8, justifyContent: 'space-between' }}>
                {/* TITLE */}
                <View style={{ alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 0.2 }}>ಅಚ್ಚು ಕನ್ನಡ </Text>
                    <View style={{ backgroundColor: THEME.primary, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, transform: [{ rotate: '-2deg' }] }}>
                      <Text style={{ color: '#0a0a0c', fontSize: 19, fontWeight: '900' }}>Pro</Text>
                    </View>
                    <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 0.2 }}> ಅನ್‌ಲಾಕ್ ಮಾಡಿ</Text>
                  </View>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11.5, marginTop: 4, textAlign: 'center' }}>
                    {paywallConfig?.subtitle || 'ಎಲ್ಲವನ್ನೂ ಅನ್‌ಲಾಕ್ ಮಾಡಿ. ಮಿತಿಗಳಿಲ್ಲದೆ ರಚಿಸಿ.'}
                  </Text>
                </View>

                {/* FEATURES — compact 2-column grid */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 10 }}>
                  {FEATURES.map((f) => (
                    <View key={f.label} style={{ width: '48.5%', flexDirection: 'row', alignItems: 'center', paddingVertical: 5 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: 'rgba(221,198,22,0.14)', justifyContent: 'center', alignItems: 'center', marginRight: 7 }}>
                        <MaterialIcons name={f.icon} size={13} color={THEME.primary} />
                      </View>
                      <Text style={{ flex: 1, color: '#fff', fontSize: 11.5, fontWeight: '600' }} numberOfLines={1}>{f.label}</Text>
                    </View>
                  ))}
                </View>

                {/* MAIN PLANS */}
                <View style={{ marginTop: 14 }}>
                  <View style={{ flexDirection: 'row', gap: 7, alignItems: 'flex-end' }}>
                    {MAIN_PLANS.map((plan: any) => {
                      const isSelected = selectedPlan === plan.id;
                      return (
                        <TouchableOpacity
                          key={plan.id}
                          onPress={() => setSelectedPlan(plan.id)}
                          activeOpacity={0.85}
                          style={{ flex: 1, position: 'relative' }}
                        >
                          {plan.badge ? (
                            <View style={{ position: 'absolute', top: -9, left: 0, right: 0, alignItems: 'center', zIndex: 2 }}>
                              <View style={{
                                backgroundColor: plan.badge === 'Best Value' ? '#E11D48' : THEME.primary,
                                paddingHorizontal: 8, paddingVertical: 2, borderRadius: 7,
                                transform: [{ rotate: plan.badge === 'Best Value' ? '-4deg' : '4deg' }],
                                elevation: 4,
                              }}>
                                <Text style={{
                                  color: plan.badge === 'Best Value' ? '#fff' : '#0a0a0c',
                                  fontSize: 8, fontWeight: '900', letterSpacing: 0.3,
                                }}>{plan.badge}</Text>
                              </View>
                            </View>
                          ) : null}
                          <View style={{
                            borderRadius: 14,
                            overflow: 'hidden',
                            borderWidth: isSelected ? 2 : 1,
                            borderColor: isSelected ? THEME.primary : 'rgba(255,255,255,0.14)',
                            backgroundColor: 'rgba(255,255,255,0.04)',
                          }}>
                            <View style={{ paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center' }}>
                              <Text style={{ color: isSelected ? THEME.primary : '#fff', fontSize: 16, fontWeight: '900' }}>{plan.price}</Text>
                              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: '500', marginTop: 1 }}>{plan.per}</Text>
                            </View>
                            <View style={{
                              backgroundColor: isSelected ? THEME.primary : 'rgba(255,255,255,0.08)',
                              paddingVertical: 6, alignItems: 'center',
                            }}>
                              <Text style={{ color: isSelected ? '#0a0a0c' : '#fff', fontSize: 11, fontWeight: '800' }}>{plan.label}</Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* EXTRA PLANS */}
                <View style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {EXTRA_PLANS.map((plan: any) => {
                      const isSelected = selectedPlan === plan.id;
                      return (
                        <TouchableOpacity
                          key={plan.id}
                          onPress={() => setSelectedPlan(plan.id)}
                          activeOpacity={0.8}
                          style={{
                            flex: 1,
                            alignItems: 'center',
                            paddingVertical: 7,
                            paddingHorizontal: 4,
                            borderRadius: 10,
                            borderWidth: isSelected ? 1.5 : 1,
                            borderColor: isSelected ? THEME.primary : 'rgba(255,255,255,0.12)',
                            backgroundColor: isSelected ? 'rgba(221,198,22,0.08)' : 'rgba(255,255,255,0.03)',
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{plan.label}</Text>
                          <Text style={{ color: isSelected ? THEME.primary : 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '800', marginTop: 2 }}>
                            {plan.price}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* CTA BUTTON */}
                <TouchableOpacity
                  onPress={async () => {
                    try {
                      await buyPlan(selectedPlan as PlanId);
                      // Success path is handled by the purchaseUpdatedListener in billing.ts;
                      // it will flip isPro via the onPurchased callback passed to initBilling.
                    } catch (e: any) {
                      showThemedAlert('ಖರೀದಿ ವಿಫಲವಾಗಿದೆ', e?.message || 'ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.', undefined, 'error-outline');
                    }
                  }}
                  activeOpacity={0.9}
                  style={{ marginTop: 12, borderRadius: 26, overflow: 'hidden', shadowColor: THEME.primary, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10 }}
                >
                  <LinearGradient
                    colors={[THEME.primary, '#F4D86B', THEME.primary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ paddingVertical: 13, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: '#0a0a0c', fontSize: 15.5, fontWeight: '900', letterSpacing: 0.3 }}>
                      {paywallConfig?.ctaText || 'ಈಗಲೇ Pro ಅನ್‌ಲಾಕ್ ಮಾಡಿ'}
                    </Text>
                    <Text style={{ color: 'rgba(10,10,12,0.7)', fontSize: 10, fontWeight: '600', marginTop: 1 }}>
                      {selectedPlanData.price}{selectedPlanData.per} · {selectedPlanData.billing}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>

                {/* FOOTER LINKS */}
                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8, gap: 2 }}>
                  <TouchableOpacity onPress={() => Linking.openURL('https://acchukannada.com/terms')} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>ಬಳಕೆಯ ನಿಯಮಗಳು</Text>
                  </TouchableOpacity>
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>|</Text>
                  <TouchableOpacity onPress={() => Linking.openURL('https://acchukannada.com/privacy')} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>ಗೌಪ್ಯತಾ ನೀತಿ</Text>
                  </TouchableOpacity>
                  <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>|</Text>
                  <TouchableOpacity onPress={async () => {
                    const ok = await restorePurchases();
                    if (ok) {
                      setIsPro(true);
                      setPaywallVisible(false);
                      setCrownModalVisible(false);
                      showThemedAlert('ಪುನಃಸ್ಥಾಪಿಸಲಾಗಿದೆ', 'ನಿಮ್ಮ Pro ಖರೀದಿಯನ್ನು ಪುನಃಸ್ಥಾಪಿಸಲಾಗಿದೆ.', undefined, 'check-circle');
                    } else {
                      showThemedAlert('ಖರೀದಿಯನ್ನು ಮರುಸ್ಥಾಪಿಸಿ', 'ಈ ಖಾತೆಗೆ ಯಾವುದೇ ಹಿಂದಿನ ಖರೀದಿಗಳು ಕಂಡುಬಂದಿಲ್ಲ.', undefined, 'refresh');
                    }
                  }} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>ಮರುಸ್ಥಾಪಿಸಿ</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })()}
      </Modal>

      {/* ── Mask Editor Modal ── */}
      <Modal visible={maskEditorVisible} animationType="slide" onRequestClose={() => setMaskEditorVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: safeTop + 8, paddingBottom: 8, backgroundColor: THEME.bgSurface }}>
            <TouchableOpacity onPress={() => setMaskEditorVisible(false)} style={{ padding: 8 }}>
              <MaterialIcons name="close" size={24} color={THEME.textMain} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: THEME.textMain, fontSize: 16, fontWeight: '600' }}>Refine Subject Mask</Text>
              {maskZoom > 1.05 && <Text style={{ color: THEME.textMuted, fontSize: 10, marginTop: 2 }}>{Math.round(maskZoom * 100)}% — pinch to zoom</Text>}
            </View>
            <TouchableOpacity onPress={applyRefinedMask} style={{ backgroundColor: THEME.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16 }}>
              <Text style={{ color: '#000', fontWeight: '700', fontSize: 13 }}>Apply</Text>
            </TouchableOpacity>
          </View>

          {/* Canvas area */}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
            <View
              onLayout={(e) => {
                const { width, height, x, y } = e.nativeEvent.layout;
                setMaskImageLayout({ w: width, h: height, x, y });
              }}
              style={{
                width: '100%',
                aspectRatio: imgDim.w / Math.max(imgDim.h, 1),
                maxHeight: '80%',
                transform: [{ scale: maskZoom }, { translateX: maskPanOff.x / maskZoom }, { translateY: maskPanOff.y / maskZoom }],
              }}
            >
              {/* Background image for reference */}
              {bgImage && <Image source={{ uri: bgImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />}

              {/* Mask overlay — semi-transparent to show selected region */}
              {subjectMaskUri && <Image source={{ uri: subjectMaskUri }} style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} resizeMode="cover" />}

              {/* Brush strokes visual feedback — rendered as smooth Paths */}
              <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${maskImageLayout.w || 100} ${maskImageLayout.h || 100}`}>
                {[...maskStrokes, ...(currentMaskStroke.length > 0 ? [currentMaskStroke] : [])].map((stroke, si) => {
                  if (stroke.length === 0) return null;
                  const mode = stroke[0].mode;
                  const sw = stroke[0].size;
                  if (stroke.length === 1) {
                    return <SvgCircle key={si} cx={stroke[0].x} cy={stroke[0].y} r={sw / 2} fill={mode === 'add' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.7)'} />;
                  }
                  let d = `M ${stroke[0].x} ${stroke[0].y}`;
                  for (let i = 1; i < stroke.length; i++) {
                    d += ` L ${stroke[i].x} ${stroke[i].y}`;
                  }
                  return <Path key={si} d={d} stroke={mode === 'add' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.7)'} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
                })}
              </Svg>

              {/* Hidden ViewShot that captures the final mask (grayscale, no image) */}
              <View style={{ position: 'absolute', left: -9999, top: -9999, width: maskImageLayout.w || 100, height: maskImageLayout.h || 100 }}>
                <ViewShot ref={maskViewShotRef} style={{ width: '100%', height: '100%', backgroundColor: '#000' }} options={{ format: 'png', quality: 1 }}>
                  {subjectMaskUri && <Image source={{ uri: subjectMaskUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
                  <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${maskImageLayout.w || 100} ${maskImageLayout.h || 100}`}>
                    {maskStrokes.map((stroke, si) => {
                      if (stroke.length === 0) return null;
                      const mode = stroke[0].mode;
                      const sw = stroke[0].size;
                      if (stroke.length === 1) {
                        return <SvgCircle key={si} cx={stroke[0].x} cy={stroke[0].y} r={sw / 2} fill={mode === 'add' ? '#ffffff' : '#000000'} />;
                      }
                      let d = `M ${stroke[0].x} ${stroke[0].y}`;
                      for (let i = 1; i < stroke.length; i++) {
                        d += ` L ${stroke[i].x} ${stroke[i].y}`;
                      }
                      return <Path key={si} d={d} stroke={mode === 'add' ? '#ffffff' : '#000000'} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
                    })}
                  </Svg>
                </ViewShot>
              </View>

              {/* Touch handler — covers canvas for drawing & pinch gestures */}
              <View style={StyleSheet.absoluteFill} {...maskPanResponder.panHandlers} />
            </View>
          </View>

          {/* Controls */}
          <View style={{ backgroundColor: THEME.bgSurface, paddingHorizontal: 16, paddingTop: 12, paddingBottom: safeBottom + 16 }}>
            {/* Brush mode toggle */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
              <TouchableOpacity
                onPress={() => setMaskBrushMode('add')}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: maskBrushMode === 'add' ? THEME.primary : THEME.bgSurfaceHigh, gap: 6 }}
              >
                <MaterialIcons name="brush" size={18} color={maskBrushMode === 'add' ? '#000' : THEME.textMuted} />
                <Text style={{ color: maskBrushMode === 'add' ? '#000' : THEME.textMuted, fontWeight: '700', fontSize: 13 }}>Add</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMaskBrushMode('erase')}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: maskBrushMode === 'erase' ? '#EF4444' : THEME.bgSurfaceHigh, gap: 6 }}
              >
                <MaterialIcons name="auto-fix-off" size={18} color={maskBrushMode === 'erase' ? '#fff' : THEME.textMuted} />
                <Text style={{ color: maskBrushMode === 'erase' ? '#fff' : THEME.textMuted, fontWeight: '700', fontSize: 13 }}>Erase</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { if (maskStrokes.length > 0) setMaskStrokes(s => s.slice(0, -1)); }}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: THEME.bgSurfaceHigh, gap: 6 }}
              >
                <MaterialIcons name="undo" size={18} color={THEME.textMuted} />
                <Text style={{ color: THEME.textMuted, fontWeight: '700', fontSize: 13 }}>Undo</Text>
              </TouchableOpacity>
              {maskZoom > 1.05 && (
                <TouchableOpacity
                  onPress={() => { setMaskZoom(1); setMaskPanOff({ x: 0, y: 0 }); }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: THEME.bgSurfaceHigh, gap: 6 }}
                >
                  <MaterialIcons name="fit-screen" size={18} color={THEME.textMuted} />
                  <Text style={{ color: THEME.textMuted, fontWeight: '700', fontSize: 13 }}>Fit</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Brush size slider */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <MaterialIcons name="circle" size={12} color={THEME.textMuted} />
              <View style={{ flex: 1 }}>
                <CustomSlider min={2} max={80} step={1} value={maskBrushSize} onChange={(v: number) => setMaskBrushSize(v)} />
              </View>
              <MaterialIcons name="circle" size={24} color={THEME.textMuted} />
              <Text style={{ color: THEME.textMuted, fontSize: 12, width: 30, textAlign: 'right' }}>{maskBrushSize}</Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Themed Alert Modal ── */}

      {/* Pro features lock overlay — on top of everything */}
      {hasProFeaturesInUse && appState === 'editor' && (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', zIndex: 9999, elevation: 9999 }]} pointerEvents="none">
          <View style={{ justifyContent: 'center', alignItems: 'center', opacity: 0.25 }}>
            <MaterialIcons name="lock" size={150} color="#fff" />
          </View>
        </View>
      )}

      <Modal visible={themedAlert.visible} transparent animationType="fade" onRequestClose={dismissThemedAlert}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 30 }}>
          <View style={{ width: '100%', maxWidth: 320, backgroundColor: THEME.bgSurface, borderRadius: 20, borderWidth: 1, borderColor: THEME.outline, overflow: 'hidden' }}>
            {/* Header */}
            <View style={{ alignItems: 'center', paddingTop: 24, paddingHorizontal: 24, paddingBottom: 8 }}>
              {themedAlert.icon && (
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: THEME.primaryContainer, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                  <MaterialIcons name={themedAlert.icon as any} size={24} color={THEME.primary} />
                </View>
              )}
              <Text style={{ color: THEME.textMain, fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>{themedAlert.title}</Text>
              <Text style={{ color: THEME.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>{themedAlert.message}</Text>
            </View>
            {/* Divider */}
            <View style={{ height: 1, backgroundColor: THEME.outline, marginTop: 16 }} />
            {/* Buttons */}
            <View style={{ flexDirection: themedAlert.buttons.length <= 2 ? 'row' : 'column' }}>
              {themedAlert.buttons.map((btn, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => { dismissThemedAlert(); btn.onPress?.(); }}
                  style={{
                    flex: themedAlert.buttons.length <= 2 ? 1 : undefined,
                    paddingVertical: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRightWidth: themedAlert.buttons.length <= 2 && i < themedAlert.buttons.length - 1 ? 1 : 0,
                    borderTopWidth: themedAlert.buttons.length > 2 && i > 0 ? 1 : 0,
                    borderColor: THEME.outline,
                  }}
                >
                  <Text style={{
                    fontSize: 14,
                    fontWeight: btn.style === 'cancel' ? '500' : '700',
                    color: btn.style === 'destructive' ? THEME.error : btn.style === 'cancel' ? THEME.textMuted : THEME.primary,
                  }}>{btn.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  splashContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SAFE_HORIZONTAL_PADDING }, mainLogoImage: { width: 160, height: 160, marginBottom: 25, marginTop: -15 }, splashTitle: { color: THEME.textMain, fontSize: 22, fontFamily: 'Padyakke', textAlign: 'center', marginBottom: 10 },
  splashFooter: { position: 'absolute', bottom: 60, alignItems: 'center', width: '100%' }, splashSubtitle: { color: THEME.textMuted, fontSize: 13, fontFamily: 'ATSSmooth', letterSpacing: 1, textAlign: 'center', marginBottom: 16 }, splashVersion: { color: 'rgba(255,255,255,0.25)', fontSize: 11, fontFamily: 'ATSSmooth', letterSpacing: 2, marginBottom: 4 }, splashCopyright: { color: 'rgba(255,255,255,0.15)', fontSize: 10, fontFamily: 'ATSSmooth', textAlign: 'center' },
  primaryBtn: { flexDirection: 'row', backgroundColor: THEME.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 20, alignItems: 'center', elevation: 1 }, primaryBtnText: { color: '#000000', fontWeight: '600', fontSize: 15, letterSpacing: 0.3 },
  headerSafeArea: { backgroundColor: THEME.bgSurface }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SAFE_HORIZONTAL_PADDING, height: HEADER_HEIGHT }, iconBtn: { padding: 10, borderRadius: 20 }, headerTitle: { color: THEME.textMain, fontSize: 16, fontWeight: '500', letterSpacing: 1, textTransform: 'uppercase' }, exportBtn: { padding: 10 },
  canvasContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000' }, viewShot: { overflow: 'hidden', backgroundColor: '#000000' }, draggable: { position: 'absolute', zIndex: 100 }, stickerImage: { width: 100, height: 100 },
  resizeHandleSquare: { position: 'absolute', width: 10, height: 10, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: THEME.boundingBox, borderRadius: 2, zIndex: 200 }, rotateHandleCircle: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: THEME.boundingBox, zIndex: 200 },
  bottomPanelWrapper: { backgroundColor: THEME.bgSurface }, bottomArea: { backgroundColor: THEME.bgSurface, paddingTop: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  dragHandle: { width: 32, height: 4, borderRadius: 2, backgroundColor: '#4a4b4e', alignSelf: 'center', marginTop: 6, marginBottom: 2 },
  cropGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, width: '100%' }, cropBtn: { width: '30%', height: 60, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'transparent' }, cropBtnActive: { borderColor: THEME.primary, backgroundColor: 'rgba(221, 198, 22, 0.1)' }, cropBtnText: { color: THEME.textMain, fontWeight: '600', fontSize: 13 }, cropBtnTextActive: { color: THEME.primary }, cropSub: { color: THEME.textMuted, fontSize: 9, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  cropPill: { alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.bgSurfaceHigh, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#3a3b3e' }, cropPillActive: { backgroundColor: THEME.primary, borderColor: THEME.primary }, cropPillText: { color: THEME.textMuted, fontSize: 12, fontWeight: '600' }, cropPillTextActive: { color: '#000000' },
  segmentedControl: { flexDirection: 'row', backgroundColor: THEME.bgSurface, paddingVertical: 0, paddingBottom: 2 }, segmentBtn: { flex: 1, flexDirection: 'column', paddingVertical: 4, alignItems: 'center', justifyContent: 'center' }, segmentBtnActive: { }, segmentText: { color: THEME.textMuted, fontWeight: '500', fontSize: 9, marginTop: 2, letterSpacing: 0.3 }, segmentTextActive: { color: THEME.primary },
  navIndicator: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 16 }, navIndicatorActive: { backgroundColor: 'rgba(221, 198, 22, 0.15)' },
  tabContent: { height: BOTTOM_PANEL_HEIGHT - 56, paddingHorizontal: SAFE_HORIZONTAL_PADDING, paddingTop: 4 }, categoryRow: { flexDirection: 'row', marginBottom: 12, maxHeight: 32 }, categoryPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, marginRight: 8, backgroundColor: THEME.bgSurfaceHigh, borderWidth: 1, borderColor: '#3a3b3e' }, categoryPillActive: { backgroundColor: THEME.primary, borderColor: THEME.primary }, categoryText: { color: THEME.textMuted, fontSize: 11, fontWeight: '600' }, categoryTextActive: { color: '#000000' },
  stickerMenu: { flexDirection: 'row' }, stickerCard: { width: 72, height: 72, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 10 }, stickerIcon: { width: 56, height: 56 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' }, secondaryBtn: { flexDirection: 'row', backgroundColor: THEME.primary, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 20, alignItems: 'center', marginBottom: 12, elevation: 1 }, secondaryBtnText: { color: '#000000', fontWeight: '600', fontSize: 14, marginLeft: 8 }, emptyStateSub: { color: THEME.textMuted, fontSize: 11 },
  subTabRow: { flexDirection: 'row', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: '#2a2b2e', paddingBottom: 0 }, subTabBtn: { marginRight: 16, paddingBottom: 10, paddingHorizontal: 4 }, subTabBtnActive: { borderBottomWidth: 3, borderBottomColor: THEME.primary }, subTabText: { color: THEME.textMuted, fontSize: 12, fontWeight: '600' }, subTabTextActive: { color: THEME.textMain },
  advancedMenu: { flex: 1 }, toolsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }, miniAddBtn: { width: 36, height: 36, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  controlRow: { flexDirection: 'row', gap: 8 }, stylePill: { flexDirection: 'row', backgroundColor: THEME.bgSurfaceHigh, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginRight: 6, justifyContent: 'center', alignItems: 'center' }, stylePillActive: { backgroundColor: THEME.primary }, stylePillText: { color: THEME.textMuted, fontWeight: '600', fontSize: 12 }, stylePillTextActive: { color: '#000000' },
  toolsMiddleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }, toggleGroup: { flexDirection: 'row' }, 
  proBtn: { flexDirection: 'row', backgroundColor: THEME.bgSurfaceHigh, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, alignItems: 'center' }, deleteBtn: { flexDirection: 'row', backgroundColor: THEME.error, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, alignItems: 'center' }, 
  sectionTitle: { color: THEME.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' },
  colorTargetRow: { flexDirection: 'row', marginBottom: 12, backgroundColor: THEME.bgBase, borderRadius: 20, padding: 4 }, colorTargetBtn: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 16 }, colorTargetBtnActive: { backgroundColor: THEME.bgSurfaceHigh }, colorTargetText: { color: THEME.textMuted, fontSize: 11, fontWeight: '600' }, colorTargetTextActive: { color: THEME.textMain },
  colorPaletteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, colorGridSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  textInputOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.95)', zIndex: 200, paddingHorizontal: SAFE_HORIZONTAL_PADDING }, textOverlayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }, textOverlayCancel: { color: THEME.textMuted, fontSize: 15, fontWeight: '500' }, doneBtn: { backgroundColor: THEME.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 }, textOverlayDone: { color: '#000000', fontSize: 14, fontWeight: '600' }, mainTextInput: { flex: 1, fontSize: 45, verticalAlign: 'middle', marginBottom: 20 },
  proSliderWrapper: { marginBottom: 6, paddingHorizontal: 2 }, proSliderHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 0 }, proSliderLabel: { color: THEME.textMuted, fontSize: 11, flex: 1, fontWeight: '500', letterSpacing: 0.3 }, proSliderValue: { color: THEME.textMain, fontSize: 11, fontWeight: '600' }, sliderControl: { width: '100%', height: 52 },
  
  exportOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.98)', zIndex: 500 },
  exportHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SAFE_HORIZONTAL_PADDING, paddingBottom: 8 },
  exportTitle: { color: THEME.textMain, fontSize: 16, fontWeight: '600', letterSpacing: 0.5 },
  exportPreviewImage: { flex: 1, margin: 16, borderRadius: 16 },
  exportActionContainer: { paddingHorizontal: 24, backgroundColor: THEME.bgSurface, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  exportPrimaryBtn: { flexDirection: 'row', backgroundColor: THEME.primary, paddingVertical: 14, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 12, elevation: 1 },
  exportPrimaryBtnText: { color: '#000000', fontWeight: '600', fontSize: 15, letterSpacing: 0.3 },
  exportSecondaryBtn: { flexDirection: 'row', backgroundColor: THEME.bgSurfaceHigh, paddingVertical: 14, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  exportSecondaryBtnText: { color: THEME.textMain, fontWeight: '600', fontSize: 15, letterSpacing: 0.3 },
  exportHashtagBox: { alignItems: 'center' },
  exportHashtagText: { color: THEME.textMuted, fontSize: 12, fontFamily: 'ATSSmooth', marginBottom: 4 },
  exportHashtagKannada: { color: THEME.textMain, fontSize: 18, fontFamily: 'Padyakke', letterSpacing: 1 },

  filterPreview: { width: 56, height: 56, borderRadius: 16, backgroundColor: THEME.bgSurfaceHigh, borderWidth: 2, borderColor: 'transparent', marginBottom: 6, overflow: 'hidden' },
  filterPreviewActive: { borderColor: THEME.primary },
  filterLabel: { color: THEME.textMuted, fontSize: 10, fontWeight: '500' },
  filterLabelActive: { color: THEME.textMain },
});

const proStyles = StyleSheet.create({
  categoryPill: { backgroundColor: 'transparent', borderColor: THEME.primary, borderWidth: 1, flexDirection: 'row' as const, alignItems: 'center' as const },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center' as const, alignItems: 'center' as const, padding: 32 },
  modalCard: { backgroundColor: THEME.bgSurface, borderRadius: 28, padding: 32, alignItems: 'center' as const, width: '100%', maxWidth: 320, borderWidth: 1, borderColor: '#2a2b2e' },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(221, 198, 22, 0.1)', justifyContent: 'center' as const, alignItems: 'center' as const, marginBottom: 20 },
  title: { color: THEME.primary, fontSize: 20, fontWeight: '700' as const, marginBottom: 12, letterSpacing: 0.5 },
  desc: { color: THEME.textMuted, fontSize: 14, textAlign: 'center' as const, lineHeight: 22, marginBottom: 24 },
  btn: { backgroundColor: THEME.primary, paddingVertical: 12, paddingHorizontal: 40, borderRadius: 20 },
  btnText: { color: '#000000', fontWeight: '600' as const, letterSpacing: 0.3 },

  proToolsCard: { backgroundColor: THEME.bgSurfaceHigh, borderRadius: isSmallScreen ? 12 : 16, padding: isSmallScreen ? 10 : 14, width: '100%', alignItems: 'center' as const, borderWidth: 1, borderColor: '#2a2b2e' },
  proToolItem: { alignItems: 'center' as const, width: isSmallScreen ? 48 : 56 },
  proToolIconBg: { width: isSmallScreen ? 30 : 36, height: isSmallScreen ? 30 : 36, borderRadius: isSmallScreen ? 15 : 18, backgroundColor: 'rgba(221, 198, 22, 0.1)', justifyContent: 'center' as const, alignItems: 'center' as const, marginBottom: isSmallScreen ? 3 : 4 },
  proToolLabel: { color: THEME.textMuted, fontSize: isSmallScreen ? 7 : 8, fontWeight: '600' as const, textAlign: 'center' as const, letterSpacing: 0.3 },
  proBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: 'rgba(221, 198, 22, 0.08)', paddingVertical: isSmallScreen ? 4 : 6, paddingHorizontal: isSmallScreen ? 10 : 14, borderRadius: 16, borderWidth: 1, borderColor: THEME.primary },
  proBadgeText: { color: THEME.primary, fontSize: isSmallScreen ? 9 : 10, fontWeight: '700' as const, letterSpacing: 0.3 },

  lockedGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10, marginBottom: 12 },
  lockedStickerCard: { width: 72, height: 72, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 16, justifyContent: 'center' as const, alignItems: 'center' as const, borderWidth: 1, borderColor: 'rgba(221, 198, 22, 0.2)' },
  unlockBtn: { flexDirection: 'row' as const, backgroundColor: THEME.primary, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const, alignSelf: 'center' as const },
  unlockBtnText: { color: '#000000', fontSize: 14, fontWeight: '600' as const, letterSpacing: 0.3 },
});
