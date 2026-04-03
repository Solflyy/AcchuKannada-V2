import React, { useState, useRef, useEffect, useMemo } from 'react';
import Constants from 'expo-constants';
import { StyleSheet, Text, View, Image, ImageBackground, TouchableOpacity, Dimensions, PanResponder, SafeAreaView, StatusBar, TextInput, KeyboardAvoidingView, Platform, ScrollView, TouchableWithoutFeedback, TextStyle, ActivityIndicator, Alert, useWindowDimensions, Modal, Animated, Easing } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import ViewShot from 'react-native-view-shot';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorMatrix, concatColorMatrices } from 'react-native-color-matrix-image-filters';
import { UIManager } from 'react-native';

const HAS_COLOR_MATRIX = UIManager.getViewManagerConfig?.('CMIFColorMatrixImageFilter') != null;

SplashScreen.preventAutoHideAsync();

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const STATUS_BAR_HEIGHT = Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;

// Responsive breakpoints
const isSmallScreen = SCREEN_H < 700;
const isMediumScreen = SCREEN_H >= 700 && SCREEN_H < 800;
const BOTTOM_PANEL_HEIGHT = isSmallScreen ? 200 : isMediumScreen ? 230 : 260;
const CROP_PANEL_HEIGHT = isSmallScreen ? 100 : 110;
const HEADER_HEIGHT = isSmallScreen ? 48 : 56;
const CANVAS_HORIZONTAL_PADDING = 16;
const SAFE_HORIZONTAL_PADDING = 16;

type ElementType = 'image' | 'text';
interface CanvasElement { 
  id: string; type: ElementType; src?: string; content?: string; color?: string; 
  x: number; y: number; scale?: number; rotation?: number; 
  fontFamily?: string; fontSize?: number; letterSpacing?: number; 
  width?: number; isBold?: boolean; isItalic?: boolean; isUnderline?: boolean;
  textAlign?: 'left' | 'center' | 'right'; lineHeight?: number; opacity?: number;
  shadowColor?: string; shadowBlur?: number; shadowDistance?: number; shadowAngle?: number; shadowOpacity?: number;
  isTintable?: boolean;
}
interface PackData { id: string; name: string; isPremium?: boolean; stickers: { id: string; src: string; isTintable?: boolean; }[]; }
interface FontCategory { id: string; name: string; fonts: any[]; }

const FILTERS = [
  { id: 'none', label: 'Original', color: 'transparent', defaultStrength: 0, layers: [] as {color: string; opacity: number}[] },
  // Kodak-inspired warm film tones  
  { id: 'kodak_portra', label: 'Kodak Portra', color: 'rgb(180, 130, 70)', defaultStrength: 0.18, layers: [
    { color: 'rgb(255, 200, 140)', opacity: 0.08 },
    { color: 'rgb(60, 30, 10)', opacity: 0.06 },
  ]},
  { id: 'kodak_gold', label: 'Kodak Gold', color: 'rgb(200, 160, 50)', defaultStrength: 0.22, layers: [
    { color: 'rgb(255, 220, 80)', opacity: 0.1 },
    { color: 'rgb(80, 50, 10)', opacity: 0.08 },
  ]},
  { id: 'kodak_ektar', label: 'Kodak Ektar', color: 'rgb(180, 60, 40)', defaultStrength: 0.15, layers: [
    { color: 'rgb(255, 100, 60)', opacity: 0.07 },
    { color: 'rgb(20, 60, 80)', opacity: 0.05 },
  ]},
  // Leica-inspired clean & contrasty
  { id: 'leica_classic', label: 'Leica Classic', color: 'rgb(40, 45, 55)', defaultStrength: 0.12, layers: [
    { color: 'rgb(200, 190, 170)', opacity: 0.06 },
    { color: 'rgb(10, 15, 30)', opacity: 0.1 },
  ]},
  { id: 'leica_vivid', label: 'Leica Vivid', color: 'rgb(30, 60, 90)', defaultStrength: 0.14, layers: [
    { color: 'rgb(255, 240, 220)', opacity: 0.05 },
    { color: 'rgb(20, 40, 80)', opacity: 0.08 },
  ]},
  // Vintage / Retro looks
  { id: 'vintage_70s', label: 'Vintage 70s', color: 'rgb(140, 100, 50)', defaultStrength: 0.25, layers: [
    { color: 'rgb(255, 210, 140)', opacity: 0.12 },
    { color: 'rgb(100, 70, 30)', opacity: 0.1 },
    { color: 'rgb(180, 180, 160)', opacity: 0.06 },
  ]},
  { id: 'vintage_faded', label: 'Vintage Fade', color: 'rgb(100, 90, 80)', defaultStrength: 0.2, layers: [
    { color: 'rgb(200, 185, 160)', opacity: 0.1 },
    { color: 'rgb(120, 120, 120)', opacity: 0.12 },
  ]},
  { id: 'vintage_sepia', label: 'Vintage Sepia', color: 'rgb(160, 120, 70)', defaultStrength: 0.3, layers: [
    { color: 'rgb(210, 180, 120)', opacity: 0.15 },
    { color: 'rgb(60, 40, 20)', opacity: 0.08 },
  ]},
  // Canon-inspired natural tones
  { id: 'canon_faithful', label: 'Canon Faithful', color: 'rgb(60, 70, 80)', defaultStrength: 0.1, layers: [
    { color: 'rgb(240, 230, 220)', opacity: 0.04 },
    { color: 'rgb(30, 40, 60)', opacity: 0.06 },
  ]},
  { id: 'canon_portrait', label: 'Canon Portrait', color: 'rgb(200, 150, 130)', defaultStrength: 0.12, layers: [
    { color: 'rgb(255, 220, 200)', opacity: 0.08 },
    { color: 'rgb(50, 30, 30)', opacity: 0.04 },
  ]},
  // Konica mono / desaturated looks
  { id: 'konica_mono', label: 'Konica Mono', color: 'rgb(128, 128, 128)', defaultStrength: 0.65, layers: [
    { color: 'rgb(20, 20, 20)', opacity: 0.08 },
    { color: 'rgb(220, 220, 210)', opacity: 0.04 },
  ]},
  { id: 'konica_noir', label: 'Konica Noir', color: 'rgb(100, 100, 100)', defaultStrength: 0.7, layers: [
    { color: 'rgb(0, 0, 0)', opacity: 0.15 },
    { color: 'rgb(180, 170, 155)', opacity: 0.05 },
  ]},
  { id: 'konica_silver', label: 'Konica Silver', color: 'rgb(150, 150, 150)', defaultStrength: 0.5, layers: [
    { color: 'rgb(200, 200, 210)', opacity: 0.08 },
    { color: 'rgb(40, 40, 50)', opacity: 0.06 },
  ]},
];

const CLOUD_DATABASE_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/stickers/sticker-packs.json';
const CLOUD_FONTS_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/fonts.json';
const SPLASH_LOGO_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/logos/Achhu%20Kannada%20LOGO.png';
const CLOUD_TEXT_PRESETS_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/textPresets.json';
const CLOUD_SPLASH_TEXT_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/splashText.json';
const APP_BG_URL = 'https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/assets/backgrounds/BG.webp';

const fixGithubUrl = (url: string) => url.replace(
  /raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?!refs\/heads\/)(.+)/,
  'raw.githubusercontent.com/$1/$2/refs/heads/$3'
);

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT = 10000; // 10 seconds

const fetchWithTimeout = (url: string, opts: RequestInit = {}, timeout = FETCH_TIMEOUT): Promise<Response> => {
  const controller = new AbortController();
  const existingSignal = opts.signal;
  const timer = setTimeout(() => controller.abort(), timeout);
  if (existingSignal) existingSignal.addEventListener('abort', () => controller.abort());
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const cachedFetch = async (url: string, cacheKey: string, signal?: AbortSignal): Promise<any> => {
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL) return data;
    }
  } catch {}
  const res = await fetchWithTimeout(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  try { await AsyncStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() })); } catch {}
  return data;
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

const PRESET_COLORS = ['#DDC616', '#FF4444', '#FFFFFF', '#F59E0B', '#EC4899', '#8B5CF6', '#3B82F6', '#06B6D4', '#10B981', '#F44336', '#22C55E', '#84CC16'];
const PRESET_FONTS = ['Padyakke', 'ATSSmooth', 'Hubballi', 'NotoSans'];
const randomPresetStyle = (idx: number) => {
  const color = PRESET_COLORS[idx % PRESET_COLORS.length];
  const font = PRESET_FONTS[idx % PRESET_FONTS.length];
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

const CustomSlider = ({ value, min, max, step, onChange, onStart, onComplete }: any) => {
  const [isActive, setIsActive] = useState(false);
  const widthRef = useRef(0);
  const valRef = useRef(value);
  const startValRef = useRef(value);
  const activatedRef = useRef(false);
  const propsRef = useRef({ min, max, step, range: max - min });

  valRef.current = value;
  propsRef.current = { min, max, step, range: max - min };

  const percentage = propsRef.current.range > 0 ? (value - propsRef.current.min) / propsRef.current.range : 0;

  const DEAD_ZONE = 8; // pixels before slider activates

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 4,
      onPanResponderGrant: () => {
        startValRef.current = valRef.current;
        activatedRef.current = false;
      },
      onPanResponderMove: (e, gesture) => {
        if (widthRef.current === 0) return; 
        
        if (!activatedRef.current) {
          if (Math.abs(gesture.dx) < DEAD_ZONE) return;
          activatedRef.current = true;
          setIsActive(true);
          if (onStart) onStart();
        }
        
        const { min, max, step, range } = propsRef.current;
        const adjustedDx = gesture.dx > 0 ? gesture.dx - DEAD_ZONE : gesture.dx + DEAD_ZONE;
        const ratio = adjustedDx / widthRef.current;
        let newValue = startValRef.current + (ratio * range);
        
        let clamped = Math.max(min, Math.min(max, newValue));

        if (step) {
          clamped = Math.round(clamped / step) * step;
        }
        
        onChange(clamped);
      },
      onPanResponderRelease: () => {
        setIsActive(false);
        if (activatedRef.current && onComplete) onComplete();
        activatedRef.current = false;
      },
      onPanResponderTerminate: () => {
        setIsActive(false);
        if (activatedRef.current && onComplete) onComplete();
        activatedRef.current = false;
      }
    })
  ).current;

  const SLIDER_COLOR = THEME.primary;
  const SLIDER_TRACK_BG = '#2a2b2e';

  return (
    <View 
      style={{ height: 44, justifyContent: 'center', marginVertical: 2, overflow: 'visible', paddingHorizontal: 14 }} 
      onLayout={e => { widthRef.current = e.nativeEvent.layout.width; }} 
      {...panResponder.panHandlers}
    >
      <View style={{ position: 'absolute', left: 14, right: 14, height: 4, backgroundColor: SLIDER_TRACK_BG, borderRadius: 2 }} />
      <View style={{ position: 'absolute', left: 14, width: `${percentage * 100}%`, height: 4, backgroundColor: SLIDER_COLOR, borderRadius: 2 }} />
      <View style={{
        position: 'absolute',
        left: `${percentage * 100}%`,
        marginLeft: -11, 
        width: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        {isActive && <View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(221, 198, 22, 0.15)' }} />}
        <View style={{
          width: isActive ? 24 : 20,
          height: isActive ? 24 : 20,
          borderRadius: 12,
          backgroundColor: THEME.primary,
          elevation: 1
        }} />
      </View>
    </View>
  );
};

const ProSlider = ({ icon, label, value, min, max, step, onChange, onStart, onComplete, displayValue }: any) => (
  <View style={styles.proSliderWrapper}>
    <View style={styles.proSliderHeader}>
      <Text style={styles.proSliderLabel}>{label}</Text>
      <Text style={styles.proSliderValue}>{displayValue !== undefined ? displayValue : value}</Text>
    </View>
    <CustomSlider min={min} max={max} step={step} value={value} onStart={onStart} onChange={onChange} onComplete={onComplete} />
  </View>
);

const DraggableBackground = React.memo(({ src, imgDim, canvasW, canvasH, isLocked, filterColor, filterStrength, filterLayers, exposure, brightness, contrast, highlights, shadows, temp, tint, fade, saturation, vibrance }: any) => {
  const [, setRenderTick] = useState(0);
  const baseScaleRef = useRef(Math.max(canvasW / imgDim.w, canvasH / imgDim.h));
  const transform = useRef({ x: 0, y: 0, scale: baseScaleRef.current }).current;
  const gesture = useRef({ startX: 0, startY: 0, lastX: 0, lastY: 0, pointers: 0, initialDist: 0, lastScale: baseScaleRef.current }).current;
  const dimsRef = useRef({ canvasW, canvasH, imgW: imgDim.w, imgH: imgDim.h });

  useEffect(() => {
    const newBase = Math.max(canvasW / imgDim.w, canvasH / imgDim.h);
    baseScaleRef.current = newBase;
    dimsRef.current = { canvasW, canvasH, imgW: imgDim.w, imgH: imgDim.h };
    transform.scale = newBase; transform.x = 0; transform.y = 0; gesture.lastX = 0; gesture.lastY = 0; gesture.lastScale = newBase;
    setRenderTick(t => t + 1);
  }, [canvasW, canvasH, imgDim]);

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
      else if (t.length === 2) { const dist = Math.max(1, Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY)); transform.scale = Math.max(minScale, Math.min(gesture.lastScale * (dist / gesture.initialDist), 10)); newX = transform.x; newY = transform.y; }
      const boundX = Math.max(0, (imgW * transform.scale - cW) / 2); const boundY = Math.max(0, (imgH * transform.scale - cH) / 2);
      transform.x = Math.max(-boundX, Math.min(newX, boundX)); transform.y = Math.max(-boundY, Math.min(newY, boundY));
      setRenderTick(t => t + 1);
    },
    onPanResponderRelease: () => { gesture.pointers = 0; gesture.lastX = transform.x; gesture.lastY = transform.y; gesture.lastScale = transform.scale; }
  })).current;

  const adjustmentMatrix = useMemo(() => {
    const matrices: any[] = [];

    // Exposure: multiplicative brightness (like camera EV)
    if (exposure !== 0) {
      const f = Math.pow(2, exposure); // EV-style: -1 = half, +1 = double
      matrices.push([
        f, 0, 0, 0, 0,
        0, f, 0, 0, 0,
        0, 0, f, 0, 0,
        0, 0, 0, 1, 0,
      ]);
    }

    // Brightness: additive offset
    if (brightness !== 0) {
      const b = brightness * 0.3; // scale to reasonable range
      matrices.push([
        1, 0, 0, 0, b,
        0, 1, 0, 0, b,
        0, 0, 1, 0, b,
        0, 0, 0, 1, 0,
      ]);
    }

    // Contrast: scale around midpoint
    if (contrast !== 0) {
      const c = 1 + contrast; // range 0..2
      const t = (1 - c) / 2;
      matrices.push([
        c, 0, 0, 0, t,
        0, c, 0, 0, t,
        0, 0, c, 0, t,
        0, 0, 0, 1, 0,
      ]);
    }

    // Highlights: lift bright areas (approximate with gamma-like matrix)
    if (highlights !== 0) {
      const h = highlights * 0.25;
      // Positive = brighten highlights, negative = darken highlights
      matrices.push([
        1 + h, 0, 0, 0, h * 0.1,
        0, 1 + h, 0, 0, h * 0.1,
        0, 0, 1 + h, 0, h * 0.1,
        0, 0, 0, 1, 0,
      ]);
    }

    // Shadows: adjust dark areas
    if (shadows !== 0) {
      const s = shadows * 0.3;
      // Positive = lift shadows (add light), negative = crush shadows
      matrices.push([
        1, 0, 0, 0, s * 0.3,
        0, 1, 0, 0, s * 0.3,
        0, 0, 1, 0, s * 0.3,
        0, 0, 0, 1, 0,
      ]);
    }

    // Saturation
    if (saturation !== 0) {
      const s = 1 + saturation; // range 0..2
      const lr = 0.2126, lg = 0.7152, lb = 0.0722; // Rec.709 luminance
      const sr = (1 - s) * lr, sg = (1 - s) * lg, sb = (1 - s) * lb;
      matrices.push([
        sr + s, sg, sb, 0, 0,
        sr, sg + s, sb, 0, 0,
        sr, sg, sb + s, 0, 0,
        0, 0, 0, 1, 0,
      ]);
    }

    // Vibrance: selective saturation (boost less-saturated colors more)
    if (vibrance !== 0) {
      const v = vibrance * 0.6;
      const lr = 0.2126, lg = 0.7152, lb = 0.0722;
      // Vibrance boosts saturation less aggressively than saturation slider
      const sv = 1 + v;
      const vr = (1 - sv) * lr, vg = (1 - sv) * lg, vb = (1 - sv) * lb;
      matrices.push([
        vr + sv, vg, vb, 0, 0,
        vr, vg + sv, vb, 0, 0,
        vr, vg, vb + sv, 0, 0,
        0, 0, 0, 1, 0,
      ]);
    }

    // Temperature: warm (orange shift) / cool (blue shift)
    if (temp !== 0) {
      const t = temp * 0.3;
      matrices.push([
        1 + t, 0, 0, 0, 0,
        0, 1, 0, 0, 0,
        0, 0, 1 - t, 0, 0,
        0, 0, 0, 1, 0,
      ]);
    }

    // Tint: green-magenta shift
    if (tint !== 0) {
      const ti = tint * 0.2;
      matrices.push([
        1 + ti * 0.5, 0, 0, 0, 0,
        0, 1 - Math.abs(ti) * 0.3, 0, 0, 0,
        0, 0, 1 + ti * 0.5, 0, 0,
        0, 0, 0, 1, 0,
      ]);
    }

    // Fade: lift blacks (add gray to shadows)
    if (fade > 0) {
      const f = fade * 0.25;
      matrices.push([
        1 - f, 0, 0, 0, f,
        0, 1 - f, 0, 0, f,
        0, 0, 1 - f, 0, f,
        0, 0, 0, 1, 0,
      ]);
    }

    if (matrices.length === 0) return null;
    return matrices.length === 1 ? matrices[0] : concatColorMatrices(matrices as any);
  }, [exposure, brightness, contrast, highlights, shadows, saturation, vibrance, temp, tint, fade]);

  const imageElement = <Image source={{ uri: src }} style={{ width: imgDim.w, height: imgDim.h }} />;

  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]} {...(isLocked ? {} : panResponder.panHandlers)}>
      <View style={{ transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.scale }] }}>
        {adjustmentMatrix && HAS_COLOR_MATRIX ? (
          <ColorMatrix matrix={adjustmentMatrix as any}>
            {imageElement}
          </ColorMatrix>
        ) : imageElement}

        {/* Overlay fallback when native color matrix is unavailable (Expo Go) */}
        {!HAS_COLOR_MATRIX && (
          <>
            {exposure !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: exposure > 0 ? '#FFFFFF' : '#000000', opacity: Math.abs(exposure) * 0.5, pointerEvents: 'none' }]} />}
            {contrast !== 0 && contrast < 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#808080', opacity: Math.abs(contrast) * 0.4, pointerEvents: 'none' }]} />}
            {contrast > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: contrast * 0.12, pointerEvents: 'none' }]} />}
            {highlights !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: highlights > 0 ? '#FFFFFF' : '#000000', opacity: Math.abs(highlights) * 0.2, pointerEvents: 'none' }]} />}
            {shadows !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: shadows > 0 ? '#333333' : '#000000', opacity: Math.abs(shadows) * 0.3, pointerEvents: 'none' }]} />}
            {saturation < 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#808080', opacity: Math.abs(saturation) * 0.5, pointerEvents: 'none' }]} />}
            {saturation > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FF4500', opacity: saturation * 0.1, pointerEvents: 'none' }]} />}
            {vibrance > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#4169E1', opacity: vibrance * 0.08, pointerEvents: 'none' }]} />}
            {vibrance < 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#808080', opacity: Math.abs(vibrance) * 0.25, pointerEvents: 'none' }]} />}
            {temp !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: temp > 0 ? '#FF8C00' : '#0066FF', opacity: Math.abs(temp) * 0.2, pointerEvents: 'none' }]} />}
            {tint !== 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: tint > 0 ? '#FF00FF' : '#00FF00', opacity: Math.abs(tint) * 0.12, pointerEvents: 'none' }]} />}
            {fade > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#808080', opacity: fade * 0.35, pointerEvents: 'none' }]} />}
          </>
        )}
        
        {filterColor !== 'transparent' && filterStrength > 0 && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: filterColor, opacity: filterStrength, pointerEvents: 'none' }]} />
        )}
        
        {filterLayers && filterStrength > 0 && filterLayers.map((layer: any, i: number) => (
          <View key={i} style={[StyleSheet.absoluteFill, { backgroundColor: layer.color, opacity: layer.opacity * filterStrength, pointerEvents: 'none' }]} />
        ))}
      </View>
    </View>
  );
});

const imageDimCache = new Map<string, number>();

const DraggableItem = React.memo(({ item, isSelected, canvasW, canvasH, fontList, onTap, onDoubleTap, onDragStart, onDragMove, onDragEnd, onWidthChangeStart, onWidthChange, onWidthChangeEnd }: any) => {
  const [, setRenderTick] = useState(0);
  const [size, setSize] = useState({ w: item.width || 0, h: 0 });
  const [stickerAspect, setStickerAspect] = useState(1);
  const transform = useRef({ x: item.x, y: item.y, scale: item.scale || 1, rotation: item.rotation || 0 }).current;
  const gestureState = useRef({ startX: 0, startY: 0, lastX: item.x, lastY: item.y, initialDistance: 0, initialAngle: 0, lastScale: 1, lastRotation: 0, pointers: 0, lastTapTime: 0, snappedX: false, snappedY: false, snappedRot: false, snapTypeX: '' as string, snapTypeY: '' as string }).current;
  const resizeRef = useRef({ startWidth: item.width || 200, startX: 0, startScale: 1, startRotation: 0 }).current;
  const latestProps = useRef({ onWidthChange, onWidthChangeStart, onWidthChangeEnd, onDragStart, onDragEnd, itemWidth: item.width });
  useEffect(() => { latestProps.current = { onWidthChange, onWidthChangeStart, onWidthChangeEnd, onDragStart, onDragEnd, itemWidth: item.width }; });

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
      if (Math.abs(gesture.dx) < 5 && Math.abs(gesture.dy) < 5) { const now = Date.now(); if (now - gestureState.lastTapTime < 300 && item.type === 'text') onDoubleTap(item.id); else onTap(item.id, item.type); gestureState.lastTapTime = now; }
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
    color: item.color, fontFamily: actualFont, fontSize: item.fontSize, letterSpacing: item.letterSpacing,
    textAlign: item.textAlign || 'center', lineHeight: item.lineHeight || (item.fontSize ? item.fontSize * 1.4 : 65),
    fontStyle: item.isItalic ? 'italic' : 'normal', textDecorationLine: item.isUnderline ? 'underline' : 'none',
    includeFontPadding: false, 
    textShadowColor: item.shadowOpacity && item.shadowOpacity > 0 ? hexToRgba(item.shadowColor || '#000000', item.shadowOpacity) : 'transparent',
    textShadowOffset: { width: shadowDist * Math.cos(shadowAngleRad), height: shadowDist * Math.sin(shadowAngleRad) },
    textShadowRadius: item.shadowBlur || 0
  };

  return (
    <View style={[styles.draggable, { left: canvasW / 2, top: canvasH / 2, opacity: item.opacity ?? 1, transform: [{ translateX: transform.x - size.w / 2 }, { translateY: transform.y - size.h / 2 }] }]} {...panResponder.panHandlers}>
      {/* Center snap guide - gold */}
      {gestureState.snappedX && gestureState.snapTypeX === 'center' && <View style={{ position: 'absolute', left: '50%', top: -2000, height: 4000, width: 1, backgroundColor: THEME.guideLine, zIndex: -10, opacity: 0.8 }} />}
      {gestureState.snappedY && gestureState.snapTypeY === 'center' && <View style={{ position: 'absolute', top: '50%', left: -2000, width: 4000, height: 1, backgroundColor: THEME.guideLine, zIndex: -10, opacity: 0.8 }} />}
      {/* Safe area snap guide - cyan */}
      {gestureState.snappedX && gestureState.snapTypeX === 'safe' && <View style={{ position: 'absolute', left: transform.x < 0 ? 0 : undefined, right: transform.x >= 0 ? 0 : undefined, top: -2000, height: 4000, width: 1, backgroundColor: '#4FC3F7', zIndex: -10, opacity: 0.7 }} />}
      {gestureState.snappedY && gestureState.snapTypeY === 'safe' && <View style={{ position: 'absolute', top: transform.y < 0 ? 0 : undefined, bottom: transform.y >= 0 ? 0 : undefined, left: -2000, width: 4000, height: 1, backgroundColor: '#4FC3F7', zIndex: -10, opacity: 0.7 }} />}
      {/* Edge snap guide - white */}
      {gestureState.snappedX && gestureState.snapTypeX === 'edge' && <View style={{ position: 'absolute', left: transform.x < 0 ? 0 : undefined, right: transform.x >= 0 ? 0 : undefined, top: -2000, height: 4000, width: 1.5, backgroundColor: '#FFFFFF', zIndex: -10, opacity: 0.5 }} />}
      {gestureState.snappedY && gestureState.snapTypeY === 'edge' && <View style={{ position: 'absolute', top: transform.y < 0 ? 0 : undefined, bottom: transform.y >= 0 ? 0 : undefined, left: -2000, width: 4000, height: 1.5, backgroundColor: '#FFFFFF', zIndex: -10, opacity: 0.5 }} />}
      
      <View onLayout={(e) => { const layoutW = e.nativeEvent.layout.width; const layoutH = e.nativeEvent.layout.height; setSize({ w: layoutW, h: layoutH }); }} style={{ transform: [{ scale: transform.scale }, { rotate: `${transform.rotation}deg` }] }}>
        {gestureState.snappedRot && ( <View style={{ position: 'absolute', top: '50%', left: -1000, width: 2000, height: 1, backgroundColor: THEME.guideLine, opacity: 0.6, zIndex: -5 }} /> )}
        <View style={{ width: item.type === 'image' ? item.width : (item.type === 'text' && item.width ? item.width : undefined), padding: item.type === 'text' ? 4 : 0, borderWidth: isSelected ? 2 : 0, borderColor: isSelected ? THEME.boundingBox : 'transparent', borderStyle: 'solid', overflow: 'visible' }}>
          
          {item.type === 'image' && item.src ? ( 
            <Image 
              source={{ uri: item.src }} 
              style={[{ width: stickerAspect >= 1 ? 100 : 100 * stickerAspect, height: stickerAspect >= 1 ? 100 / stickerAspect : 100 }, item.isTintable && item.color ? { tintColor: item.color } : null]} 
              resizeMode="contain" 
            /> 
          ) : ( <Text style={[baseTextStyle, { alignSelf: 'flex-start' }]}>{item.content}</Text> )}
          
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

const EXPORT_STAGES = [
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

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [appState, setAppState] = useState<'splash' | 'home' | 'crop' | 'editor'>('splash');
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [imgDim, setImgDim] = useState({ w: 1, h: 1 });
  const [activeRatio, setActiveRatio] = useState<[number, number] | null>(null);
  const [cropRotation, setCropRotation] = useState(0);
  const [showSpiral, setShowSpiral] = useState(false);
  const [spiralRotation, setSpiralRotation] = useState(0);
  const [spiralFlipH, setSpiralFlipH] = useState(false);
  const [spiralFlipV, setSpiralFlipV] = useState(false);
  const [elements, setElements] = useState<CanvasElement[]>([]);
  
  const [fontList, setFontList] = useState<any[]>(CORE_FONTS);
  const [textPresets, setTextPresets] = useState<any[]>([]);
  const [splashText, setSplashText] = useState({ title: 'ಅನುದಿನ ಕನ್ನಡ', buttonText: 'ಚಂದದ ಚಿತ್ರವನ್ನು ಆರಿಸಿ', subtitle: 'an app by Bhitthichitra Cinemas', copyright: '© 2026 Bhitthichitra Cinemas. All rights reserved' });
  const [fontCategories, setFontCategories] = useState<FontCategory[]>([]);
  const [activeFontCategoryId, setActiveFontCategoryId] = useState<string>('');
  const viewShotRef = useRef<ViewShot>(null);
  
  const [past, setPast] = useState<CanvasElement[][]>([]);
  const [future, setFuture] = useState<CanvasElement[][]>([]);
  const dragStartElements = useRef<CanvasElement[]>([]);

  const [activeTab, setActiveTab] = useState<'filters' | 'stickers' | 'text'>('filters'); 
  
  const [filterSubTab, setFilterSubTab] = useState<'presets' | 'adjust' | 'pro'>('presets');
  const [stickerSubTab, setStickerSubTab] = useState<'adjust' | 'color'>('adjust');
  const [activeFilter, setActiveFilter] = useState(FILTERS[0]); 
  const [filterStrength, setFilterStrength] = useState(FILTERS[0].defaultStrength);
  
  const defaultAdj = { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0, fade: 0, saturation: 0, vibrance: 0 };
  const [imgAdj, setImgAdj] = useState(defaultAdj);
  const setAdj = (key: keyof typeof defaultAdj, value: number) => setImgAdj(prev => ({ ...prev, [key]: value }));

  const [textSubTab, setTextSubTab] = useState<'fonts' | 'style' | 'effects' | 'color' | 'pro'>('fonts');
  const [colorTarget, setColorTarget] = useState<'color' | 'shadowColor'>('color');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [currentText, setCurrentText] = useState('');
  const [packs, setPacks] = useState<PackData[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [exportUri, setExportUri] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [printPreviewUri, setPrintPreviewUri] = useState<string | null>(null);
  const exportProgress = useRef(new Animated.Value(0)).current;
  const exportSpin = useRef(new Animated.Value(0)).current;
  const exportPulse = useRef(new Animated.Value(1)).current;
  const exportStage = useRef(new Animated.Value(0)).current;
  const [proModalVisible, setProModalVisible] = useState(false);
  const [crownModalVisible, setCrownModalVisible] = useState(false);
  const [saveSuccessVisible, setSaveSuccessVisible] = useState(false);

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
    cachedFetch(CLOUD_SPLASH_TEXT_URL, '@cache_splash_text', signal).then(data => { if (data && !signal.aborted) setSplashText(prev => ({ ...prev, ...data })); }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (appState === 'splash') { const timer = setTimeout(() => { setAppState('home'); }, 5000); return () => clearTimeout(timer); }
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
        const texts: string[] = data.textPresets || [];
        const shuffled = texts.sort(() => Math.random() - 0.5).slice(0, 30);
        const presets = shuffled.map((text, i) => {
          const style = randomPresetStyle(i);
          return { id: `cp_${i}`, text, ...style };
        });
        setTextPresets(presets);
      }),
    ]).catch(() => {});

    return () => controller.abort();
  }, []);

  if (!fontsLoaded) return null; 

  const safeTop = Math.max(insets.top, STATUS_BAR_HEIGHT);
  const safeBottom = Math.max(insets.bottom, 10);
  const safeLeft = Math.max(insets.left, SAFE_HORIZONTAL_PADDING);
  const safeRight = Math.max(insets.right, SAFE_HORIZONTAL_PADDING);
  const bottomPanelH = appState === 'crop' ? CROP_PANEL_HEIGHT : BOTTOM_PANEL_HEIGHT;
  const headerH = HEADER_HEIGHT;

  const MAX_W = width - safeLeft - safeRight; 
  const MAX_H = height - (safeTop + headerH + bottomPanelH + safeBottom); 
  const aspectToUse = activeRatio ? (activeRatio[0] / activeRatio[1]) : (imgDim.h ? imgDim.w / imgDim.h : 1);
  let renderedW = MAX_W, renderedH = MAX_H;
  if (aspectToUse > (MAX_W / MAX_H)) { renderedH = MAX_W / aspectToUse; } else { renderedW = MAX_H * aspectToUse; }

  const commitHistory = (updater: (prev: CanvasElement[]) => CanvasElement[]) => { setElements(prev => { const next = updater(prev); if (next === prev) return prev; setPast(p => [...p, prev]); setFuture([]); return next; }); };
  const undo = () => { if (past.length === 0) return; const previous = past[past.length - 1]; setPast(past.slice(0, past.length - 1)); setFuture([elements, ...future]); setElements(previous); setSelectedId(null); };
  const redo = () => { if (future.length === 0) return; const next = future[0]; setFuture(future.slice(1)); setPast([...past, elements]); setElements(next); setSelectedId(null); };
  const handleSliderStart = () => { setElements(prev => { dragStartElements.current = prev; return prev; }); };
  const handleSliderComplete = () => { setPast(p => [...p, dragStartElements.current]); setFuture([]); };

  const launchPicker = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
    if (!result.canceled && result.assets.length > 0) { 
      setBgImage(result.assets[0].uri); setImgDim({ w: result.assets[0].width, h: result.assets[0].height }); 
      setElements([]); setPast([]); setFuture([]); setSelectedId(null); setActiveRatio(null); 
      setImgAdj(defaultAdj);
      setActiveFilter(FILTERS[0]); setFilterStrength(FILTERS[0].defaultStrength);
      setAppState('crop'); 
    }
  };

  const commitText = () => { if (currentText.trim() !== '') { commitHistory(prev => [...prev, { id: Date.now().toString(), type: 'text', content: currentText, color: '#FFFFFF', fontFamily: 'Hubballi', isBold: false, isItalic: false, isUnderline: false, textAlign: 'center', opacity: 1, fontSize: 45, lineHeight: 75, letterSpacing: 0, x: 0, y: 0, scale: 1, rotation: 0, width: 250, shadowColor: '#000000', shadowBlur: 0, shadowDistance: 0, shadowAngle: 45, shadowOpacity: 0 }]); setActiveTab('text'); } setCurrentText(''); setIsTyping(false); };
  const updateSelectedStyle = (key: keyof CanvasElement, value: any) => { if (selectedId) setElements(prev => prev.map(el => el.id === selectedId ? { ...el, [key]: value } : el)); };
  const updateStyleWithHistory = (key: keyof CanvasElement, value: any) => { if (selectedId) commitHistory(prev => prev.map(el => el.id === selectedId ? { ...el, [key]: value } : el)); };
  const duplicateElement = () => { if (!selectedId) return; let newId = Date.now().toString(); commitHistory(prev => { const target = prev.find(e => e.id === selectedId); if (!target) return prev; return [...prev, { ...target, id: newId, x: target.x + 30, y: target.y + 30 }]; }); setTimeout(() => setSelectedId(newId), 0); };
  const deleteElement = () => { if (!selectedId) return; commitHistory(prev => prev.filter(e => e.id !== selectedId)); setSelectedId(null); };
  const moveLayer = (direction: 'up' | 'down') => { if (!selectedId) return; commitHistory(prev => { const idx = prev.findIndex(e => e.id === selectedId); if (idx < 0) return prev; const newArr = [...prev]; if (direction === 'up' && idx < newArr.length - 1) { [newArr[idx], newArr[idx + 1]] = [newArr[idx + 1], newArr[idx]]; } else if (direction === 'down' && idx > 0) { [newArr[idx], newArr[idx - 1]] = [newArr[idx - 1], newArr[idx]]; } return newArr; }); };
  
  const prepareExport = async () => { 
    if (!viewShotRef.current) return; 
    setSelectedId(null); 
    setIsExporting(true);
    exportProgress.setValue(0);
    exportSpin.setValue(0);
    exportPulse.setValue(1);
    exportStage.setValue(0);

    // Start animations
    Animated.loop(Animated.timing(exportSpin, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.sequence([
      Animated.timing(exportPulse, { toValue: 1.15, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(exportPulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
    // Progress 0→100 over 14s
    Animated.timing(exportProgress, { toValue: 100, duration: 14000, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: false }).start();
    // Stage transitions for status text
    Animated.sequence([
      Animated.delay(0),
      Animated.timing(exportStage, { toValue: 1, duration: 1, useNativeDriver: false }),
      Animated.delay(3000),
      Animated.timing(exportStage, { toValue: 2, duration: 1, useNativeDriver: false }),
      Animated.delay(3500),
      Animated.timing(exportStage, { toValue: 3, duration: 1, useNativeDriver: false }),
      Animated.delay(3500),
      Animated.timing(exportStage, { toValue: 4, duration: 1, useNativeDriver: false }),
    ]).start();

    // Capture immediately but hold the URI
    setTimeout(async () => { 
      try { 
        const uri = await (viewShotRef.current as any).capture(); 
        setPrintPreviewUri(uri);
        // Wait for the full 15s animation to complete
        setTimeout(() => {
          setIsExporting(false);
          exportSpin.stopAnimation();
          exportPulse.stopAnimation();
          setExportUri(uri); 
        }, 14000);
      } catch (err) { 
        setIsExporting(false);
        Alert.alert('Error', 'Failed to capture image.'); 
      } 
    }, 100); 
  };
  const saveToGallery = async () => { if (!exportUri) return; try { const { status } = await MediaLibrary.requestPermissionsAsync(true); if (status === 'granted') { const formattedUri = exportUri.startsWith('file://') ? exportUri : `file://${exportUri}`; await MediaLibrary.saveToLibraryAsync(formattedUri); setSaveSuccessVisible(true); } else { Alert.alert('Permission Needed', 'We need media library permissions to save the image.'); } } catch (err: any) { Alert.alert('Save Error', err.message || 'Could not save image.'); } };
  const shareImage = async () => { if (!exportUri) return; if (await Sharing.isAvailableAsync()) { await Sharing.shareAsync(exportUri); } else { Alert.alert('Unavailable', 'Sharing is not available on this device.'); } };

  const activeTextEl = elements.find(el => el.id === selectedId && el.type === 'text');
  const activeAnyEl = elements.find(el => el.id === selectedId);

  // WYSIWYG Fix: Safely figure out the true active font to pass to the text input
  const activeActualFont = activeTextEl 
    ? (activeTextEl.isBold ? fontList.find((f:any) => f.value === activeTextEl.fontFamily)?.boldValue || activeTextEl.fontFamily : activeTextEl.fontFamily) 
    : 'Hubballi';

  return (
    <ImageBackground source={{ uri: APP_BG_URL }} style={[styles.container, { paddingLeft: insets.left, paddingRight: insets.right }]} resizeMode="cover">
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      
      {appState === 'splash' || appState === 'home' || !bgImage ? (
        <View style={[styles.splashContent, { paddingTop: safeTop + 20 }]}>
          <Image source={{ uri: SPLASH_LOGO_URL }} style={styles.mainLogoImage} resizeMode="contain" />
          <Text style={styles.splashTitle}>{splashText.title}</Text>
          {appState === 'splash' ? ( <ActivityIndicator size="large" color={THEME.primary} style={{ marginVertical: 30, height: 56 }} /> ) : ( <View style={{ marginVertical: 30, height: 56, justifyContent: 'center' }}><TouchableOpacity style={styles.primaryBtn} onPress={launchPicker}><MaterialIcons name="image" size={20} color={THEME.bgBase} style={{marginRight: 10}} /><Text style={styles.primaryBtnText}>{splashText.buttonText}</Text></TouchableOpacity></View> )}
          <View style={[styles.splashFooter, { bottom: safeBottom + 20 }]}>
            <Text style={styles.splashSubtitle}>{splashText.subtitle}</Text>
            <Text style={styles.splashVersion}>ACCHU KANNADA v{Constants.manifest?.version || '1.0.0'}</Text>
            <Text style={styles.splashCopyright}>{splashText.copyright}</Text>
          </View>
        </View>
      ) : (
        <>
          <View style={[styles.headerSafeArea, { paddingTop: safeTop }]}>
            <View style={[styles.header, { height: headerH }]}>
              {appState === 'crop' ? ( 
                <>
                  <TouchableOpacity onPress={() => { setAppState('home'); setCropRotation(0); }} style={styles.iconBtn}><MaterialIcons name="close" size={22} color={THEME.textMain} /></TouchableOpacity>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <TouchableOpacity onPress={() => setCropRotation(r => (r - 90) % 360)} style={styles.iconBtn}><MaterialIcons name="rotate-left" size={20} color={THEME.textMain} /></TouchableOpacity>
                    <TouchableOpacity onPress={() => setCropRotation(r => (r + 90) % 360)} style={styles.iconBtn}><MaterialIcons name="rotate-right" size={20} color={THEME.textMain} /></TouchableOpacity>
                    <View style={{ width: 1, height: 20, backgroundColor: '#3a3b3e', marginHorizontal: 2 }} />
                    <TouchableOpacity onPress={() => setShowSpiral(v => !v)} style={[styles.iconBtn, { backgroundColor: showSpiral ? 'rgba(221,198,22,0.12)' : 'transparent', borderRadius: 12 }]}><MaterialIcons name="filter-tilt-shift" size={20} color={showSpiral ? THEME.primary : THEME.textMuted} /></TouchableOpacity>
                    {showSpiral && (
                      <>
                        <TouchableOpacity onPress={() => setSpiralRotation(r => (r + 90) % 360)} style={styles.iconBtn}><MaterialIcons name="rotate-right" size={18} color={THEME.primary} /></TouchableOpacity>
                        <TouchableOpacity onPress={() => setSpiralFlipH(v => !v)} style={[styles.iconBtn, { backgroundColor: spiralFlipH ? 'rgba(221,198,22,0.12)' : 'transparent', borderRadius: 12 }]}><MaterialIcons name="flip" size={18} color={spiralFlipH ? THEME.primary : THEME.textMuted} /></TouchableOpacity>
                        <TouchableOpacity onPress={() => setSpiralFlipV(v => !v)} style={[styles.iconBtn, { backgroundColor: spiralFlipV ? 'rgba(221,198,22,0.12)' : 'transparent', borderRadius: 12, transform: [{ rotate: '90deg' }] }]}><MaterialIcons name="flip" size={18} color={spiralFlipV ? THEME.primary : THEME.textMuted} /></TouchableOpacity>
                      </>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => { setAppState('editor'); setCropRotation(0); }} style={styles.iconBtn}><MaterialIcons name="check" size={22} color={THEME.primary} /></TouchableOpacity>
                </> 
              ) : ( 
                <>
                  <TouchableOpacity onPress={() => { setAppState('crop'); setSelectedId(null); }} style={styles.iconBtn}><MaterialIcons name="arrow-back" size={22} color={THEME.textMain} /></TouchableOpacity>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {selectedId && <TouchableOpacity onPress={deleteElement} style={{ padding: 10 }}><MaterialIcons name="delete" size={20} color={THEME.error} /></TouchableOpacity>}
                    <TouchableOpacity onPress={undo} disabled={past.length === 0} style={{ padding: 10, opacity: past.length === 0 ? 0.3 : 1 }}><MaterialIcons name="undo" size={20} color={THEME.textMain} /></TouchableOpacity>
                    <TouchableOpacity onPress={redo} disabled={future.length === 0} style={{ padding: 10, opacity: future.length === 0 ? 0.3 : 1 }}><MaterialIcons name="redo" size={20} color={THEME.textMain} /></TouchableOpacity>
                    <TouchableOpacity style={{ padding: 10 }} onPress={prepareExport}><MaterialIcons name="file-download" size={22} color={THEME.primary} /></TouchableOpacity>
                    <TouchableOpacity style={{ padding: 10 }} onPress={() => setCrownModalVisible(true)}><MaterialIcons name="emoji-events" size={22} color={THEME.primary} /></TouchableOpacity>
                  </View>
                </> 
              )}
            </View>
          </View>
          
          <View style={styles.canvasContainer}>
            <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1.0 }} style={[styles.viewShot, { width: renderedW, height: renderedH, transform: [{ rotate: `${cropRotation}deg` }] }]}>
              <DraggableBackground src={bgImage} imgDim={imgDim} canvasW={renderedW} canvasH={renderedH} isLocked={appState === 'editor'} filterColor={activeFilter.color} filterStrength={filterStrength} filterLayers={activeFilter.layers} exposure={imgAdj.exposure} brightness={imgAdj.brightness} contrast={imgAdj.contrast} highlights={imgAdj.highlights} shadows={imgAdj.shadows} temp={imgAdj.temp} tint={imgAdj.tint} fade={imgAdj.fade} saturation={imgAdj.saturation} vibrance={imgAdj.vibrance} />
              
              {appState === 'editor' && ( <TouchableWithoutFeedback onPress={() => setSelectedId(null)}><View style={StyleSheet.absoluteFill} /></TouchableWithoutFeedback> )}
              {appState === 'editor' && elements.map((el) => ( <DraggableItem key={el.id} item={el} isSelected={selectedId === el.id} canvasW={renderedW} canvasH={renderedH} fontList={fontList} onTap={(id:string) => {setSelectedId(id); setActiveTab(el.type === 'image' ? 'stickers' : 'text');}} onDoubleTap={() => {setSelectedId(el.id); setCurrentText(el.content||''); setIsTyping(true);}} onDragStart={() => {}} onDragMove={() => {}} onDragEnd={(id:string, y:number, tx:number, ty:number, tscale:number, trot:number) => { commitHistory(prev => {const target = prev.find(e => e.id === id); if (target && (target.x !== tx || target.y !== ty || target.scale !== tscale || target.rotation !== trot)) {return prev.map(e => e.id === id ? { ...e, x: tx, y: ty, scale: tscale, rotation: trot } : e);} return prev;});}} onWidthChangeStart={() => handleSliderStart()} onWidthChange={(id:string, newWidth:number) => updateSelectedStyle('width', newWidth)} onWidthChangeEnd={() => handleSliderComplete()} /> ))}
              {appState === 'editor' && <Image source={{ uri: SPLASH_LOGO_URL }} style={{ position: 'absolute', bottom: 5, right: 0, width: 81, height: 36, opacity: 0.6, zIndex: 999 }} resizeMode="contain" />}
            </ViewShot>
            {appState === 'crop' && (
              <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]} pointerEvents="none">
                <View style={{ width: renderedW, height: renderedH }}>
                  {/* Golden ratio lines (phi ≈ 0.618) */}
                  <View style={{ position: 'absolute', left: `${61.8}%`, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(221,198,22,0.45)' }} />
                  <View style={{ position: 'absolute', left: `${38.2}%`, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(221,198,22,0.45)' }} />
                  <View style={{ position: 'absolute', top: `${61.8}%`, left: 0, right: 0, height: 1, backgroundColor: 'rgba(221,198,22,0.45)' }} />
                  <View style={{ position: 'absolute', top: `${38.2}%`, left: 0, right: 0, height: 1, backgroundColor: 'rgba(221,198,22,0.45)' }} />
                  {/* Corner brackets */}
                  <View style={{ position: 'absolute', top: -1, left: -1, width: 24, height: 24, borderTopWidth: 3, borderLeftWidth: 3, borderColor: THEME.primary }} />
                  <View style={{ position: 'absolute', top: -1, right: -1, width: 24, height: 24, borderTopWidth: 3, borderRightWidth: 3, borderColor: THEME.primary }} />
                  <View style={{ position: 'absolute', bottom: -1, left: -1, width: 24, height: 24, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: THEME.primary }} />
                  <View style={{ position: 'absolute', bottom: -1, right: -1, width: 24, height: 24, borderBottomWidth: 3, borderRightWidth: 3, borderColor: THEME.primary }} />
                  {/* Border */}
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderColor: 'rgba(221,198,22,0.6)' }} />
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
                        return <Path d={d} stroke="rgba(221,198,22,0.5)" strokeWidth={1.5} fill="none" />;
                      })()}
                    </Svg>
                  )}
                </View>
              </View>
            )}
          </View>
          
          <View style={styles.bottomPanelWrapper}>
            <View style={[styles.bottomArea, { paddingBottom: safeBottom }]}>
              <View style={styles.dragHandle} />
              {appState === 'crop' ? (
                <View style={{ paddingTop: 8 }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: safeLeft, gap: 10, paddingBottom: 12 }}>
                    <TouchableOpacity style={[styles.cropPill, activeRatio === null && styles.cropPillActive]} onPress={() => setActiveRatio(null)}>
                      <MaterialIcons name="crop-free" size={14} color={activeRatio === null ? '#000000' : THEME.textMuted} style={{ marginRight: 6 }} />
                      <Text style={[styles.cropPillText, activeRatio === null && styles.cropPillTextActive]}>Free</Text>
                    </TouchableOpacity>
                    {[ [1,1,'crop-square','1:1'], [4,5,'smartphone','4:5'], [16,9,'laptop','16:9'], [3,2,'crop-landscape','3:2'], [9,16,'smartphone','9:16'], [5,4,'tablet','5:4'], [2,3,'crop-portrait','2:3'] ].map((r: any) => {
                      const isActive = activeRatio?.[0] === r[0] && activeRatio?.[1] === r[1];
                      return (
                        <TouchableOpacity key={r[3]} style={[styles.cropPill, isActive && styles.cropPillActive]} onPress={() => setActiveRatio([r[0], r[1]])}>
                          <MaterialIcons name={r[2]} size={14} color={isActive ? '#000000' : THEME.textMuted} style={{ marginRight: 6 }} />
                          <Text style={[styles.cropPillText, isActive && styles.cropPillTextActive]}>{r[3]}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <MaterialIcons name="open-with" size={12} color={THEME.textMuted} style={{ marginRight: 6 }} />
                      <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '500', letterSpacing: 0.8 }}>Pinch to zoom  ·  Drag to reposition</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.segmentedControl}>
                    {activeTextEl ? (<>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setTextSubTab('fonts')}><View style={[styles.navIndicator, textSubTab === 'fonts' && styles.navIndicatorActive]}><MaterialIcons name="text-fields" size={22} color={textSubTab === 'fonts' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, textSubTab === 'fonts' && styles.segmentTextActive]}>Fonts</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setTextSubTab('style')}><View style={[styles.navIndicator, textSubTab === 'style' && styles.navIndicatorActive]}><MaterialIcons name="tune" size={22} color={textSubTab === 'style' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, textSubTab === 'style' && styles.segmentTextActive]}>Style</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setTextSubTab('effects')}><View style={[styles.navIndicator, textSubTab === 'effects' && styles.navIndicatorActive]}><MaterialIcons name="auto-awesome" size={22} color={textSubTab === 'effects' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, textSubTab === 'effects' && styles.segmentTextActive]}>Effects</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setTextSubTab('color')}><View style={[styles.navIndicator, textSubTab === 'color' && styles.navIndicatorActive]}><MaterialIcons name="palette" size={22} color={textSubTab === 'color' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, textSubTab === 'color' && styles.segmentTextActive]}>Colors</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setTextSubTab('pro')}><View style={[styles.navIndicator, textSubTab === 'pro' && styles.navIndicatorActive]}><MaterialIcons name="lock" size={22} color={textSubTab === 'pro' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, textSubTab === 'pro' && { color: THEME.primary }]}>Pro</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => { setSelectedId(null); setActiveTab('filters'); }}><View style={[styles.navIndicator]}><MaterialIcons name="close" size={22} color={THEME.textMuted} /></View><Text style={[styles.segmentText]}>Back</Text></TouchableOpacity>
                    </>) : (<>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => {setActiveTab('filters'); setSelectedId(null);}}><View style={[styles.navIndicator, activeTab === 'filters' && styles.navIndicatorActive]}><MaterialIcons name="style" size={22} color={activeTab === 'filters' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, activeTab === 'filters' && styles.segmentTextActive]}>Looks</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setActiveTab('text')}><View style={[styles.navIndicator, activeTab === 'text' && styles.navIndicatorActive]}><MaterialIcons name="format-shapes" size={22} color={activeTab === 'text' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, activeTab === 'text' && styles.segmentTextActive]}>Text</Text></TouchableOpacity>
                      <TouchableOpacity style={styles.segmentBtn} onPress={() => setActiveTab('stickers')}><View style={[styles.navIndicator, activeTab === 'stickers' && styles.navIndicatorActive]}><MaterialIcons name="extension" size={22} color={activeTab === 'stickers' ? THEME.primary : THEME.textMuted} /></View><Text style={[styles.segmentText, activeTab === 'stickers' && styles.segmentTextActive]}>Stickers</Text></TouchableOpacity>
                    </>)}
                  </View>
                  
                  <View style={[styles.tabContent, { height: bottomPanelH - 70 }]}>
                    {activeTab === 'filters' && (
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                          {(['presets', 'adjust', 'pro'] as const).map(tab => (
                            <TouchableOpacity key={tab} onPress={() => setFilterSubTab(tab)} style={{ flex: 1, alignItems: 'center', paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: filterSubTab === tab ? THEME.primary : 'transparent' }}>
                              <Text style={{ color: filterSubTab === tab ? THEME.primary : THEME.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>{tab === 'pro' ? 'Pro' : tab === 'presets' ? 'Presets' : 'Adjust'}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        {filterSubTab === 'presets' && (
                          <View style={{ flex: 1, justifyContent: 'center' }}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
                              {FILTERS.map(f => (
                                <TouchableOpacity key={f.id} onPress={() => { setActiveFilter(f); setFilterStrength(f.defaultStrength); }} style={{ alignItems: 'center', marginRight: 20 }}>
                                   <View style={[styles.filterPreview, activeFilter.id === f.id && styles.filterPreviewActive, { backgroundColor: f.color, opacity: f.id === 'none' ? 1 : f.defaultStrength }]} />
                                   <Text style={[styles.filterLabel, activeFilter.id === f.id && styles.filterLabelActive]}>{f.label}</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                            
                            {activeFilter.id !== 'none' && (
                              <View style={{ marginTop: -15 }}>
                                <ProSlider icon="tune" label="Filter Strength" value={filterStrength * 100} min={0} max={100} step={1} displayValue={`${Math.round(filterStrength * 100)}%`} onChange={(v:number) => setFilterStrength(v / 100)} />
                              </View>
                            )}
                          </View>
                        )}

                        {filterSubTab === 'adjust' && (
                          <ScrollView style={{ flex: 1, paddingTop: 5 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                             <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Light</Text>
                             <ProSlider icon="wb-sunny" label="Exposure" value={imgAdj.exposure} min={-1} max={1} step={0.05} displayValue={`${Math.round(imgAdj.exposure * 100)}`} onChange={(v:number) => setAdj('exposure', v)} />
                             <View style={{ height: 6 }} />
                             <ProSlider icon="contrast" label="Contrast" value={imgAdj.contrast} min={-1} max={1} step={0.05} displayValue={`${Math.round(imgAdj.contrast * 100)}`} onChange={(v:number) => setAdj('contrast', v)} />
                             <View style={{ height: 6 }} />
                             <ProSlider icon="light-mode" label="Highlights" value={imgAdj.highlights} min={-1} max={1} step={0.05} displayValue={`${Math.round(imgAdj.highlights * 100)}`} onChange={(v:number) => setAdj('highlights', v)} />
                             <View style={{ height: 6 }} />
                             <ProSlider icon="dark-mode" label="Shadows" value={imgAdj.shadows} min={-1} max={1} step={0.05} displayValue={`${Math.round(imgAdj.shadows * 100)}`} onChange={(v:number) => setAdj('shadows', v)} />
                             <View style={{ height: 6 }} />
                             <ProSlider icon="cloud" label="Fade" value={imgAdj.fade} min={0} max={1} step={0.05} displayValue={`${Math.round(imgAdj.fade * 100)}`} onChange={(v:number) => setAdj('fade', v)} />

                             <View style={{ height: 14 }} />
                             <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Color</Text>
                             <ProSlider icon="palette" label="Saturation" value={imgAdj.saturation} min={-1} max={1} step={0.05} displayValue={`${Math.round(imgAdj.saturation * 100)}`} onChange={(v:number) => setAdj('saturation', v)} />
                             <View style={{ height: 6 }} />
                             <ProSlider icon="filter-vintage" label="Vibrance" value={imgAdj.vibrance} min={-1} max={1} step={0.05} displayValue={`${Math.round(imgAdj.vibrance * 100)}`} onChange={(v:number) => setAdj('vibrance', v)} />
                             <View style={{ height: 6 }} />
                             <ProSlider icon="thermostat" label="White Balance (Temp)" value={imgAdj.temp} min={-1} max={1} step={0.05} displayValue={`${Math.round(imgAdj.temp * 100)}`} onChange={(v:number) => setAdj('temp', v)} />
                             <View style={{ height: 6 }} />
                             <ProSlider icon="water-drop" label="White Balance (Tint)" value={imgAdj.tint} min={-1} max={1} step={0.05} displayValue={`${Math.round(imgAdj.tint * 100)}`} onChange={(v:number) => setAdj('tint', v)} />
                             
                             <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 15 }}>
                               <TouchableOpacity onPress={() => setImgAdj(defaultAdj)} style={{ paddingHorizontal: 15, paddingVertical: 8 }}>
                                 <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: 'bold' }}>Reset Adjustments</Text>
                               </TouchableOpacity>
                             </View>
                          </ScrollView>
                        )}

                        {filterSubTab === 'pro' && (
                          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: isSmallScreen ? 6 : 12 }}>
                            <View style={proStyles.proToolsCard}>
                              <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: isSmallScreen ? 8 : 12, gap: isSmallScreen ? 8 : 12 }}>
                                {[{ icon: 'image', label: 'Premium Filter' }, { icon: 'tune', label: 'Color Grading Packs' }].map((tool) => (
                                  <View key={tool.label} style={proStyles.proToolItem}>
                                    <View style={proStyles.proToolIconBg}>
                                      <MaterialIcons name={tool.icon as any} size={isSmallScreen ? 12 : 14} color={THEME.primary} />
                                    </View>
                                    <Text style={proStyles.proToolLabel}>{tool.label}</Text>
                                  </View>
                                ))}
                              </View>
                              <View style={proStyles.proBadge}>
                                <MaterialIcons name="lock" size={isSmallScreen ? 10 : 12} color={THEME.primary} style={{ marginRight: 4 }} />
                                <Text style={proStyles.proBadgeText}>Coming Soon Acchu Kannada Pro</Text>
                              </View>
                            </View>
                          </View>
                        )}
                      </View>
                    )}

                    {activeTab === 'stickers' && ( 
                      <View style={{flex: 1}}>
                        {/* Sticker selected - show adjustment bar */}
                        {activeAnyEl && activeAnyEl.type === 'image' && (
                          <View style={{ flex: 1 }}>
                              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20, paddingTop: 4 }}>
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
                                <ProSlider icon="opacity" label="Sticker Opacity" value={activeAnyEl.opacity || 1} min={0.1} max={1} step={0.1} displayValue={`${Math.round((activeAnyEl.opacity || 1) * 100)}%`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('opacity', v)} onComplete={handleSliderComplete} />
                                {activeAnyEl.isTintable && (<>
                                <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginTop: 12 }}>Sticker Color</Text>
                                <View style={styles.colorPaletteGrid}>
                                  {COLOR_PALETTE.map((color) => {
                                    const isActive = activeAnyEl.color === color;
                                    return (
                                      <TouchableOpacity key={color} onPress={() => updateStyleWithHistory('color', color)} style={[styles.colorGridSwatch, { backgroundColor: color, borderColor: isActive ? THEME.textMain : 'transparent' }]} />
                                    );
                                  })}
                                </View>
                                </>)}
                              </ScrollView>
                          </View>
                        )}
                        {!(activeAnyEl && activeAnyEl.type === 'image') && (<>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryRow}>
                          <TouchableOpacity style={[styles.categoryPill, proStyles.categoryPill, activePackId === '__pro__' && { backgroundColor: 'rgba(221, 198, 22, 0.15)' }]} onPress={() => setActivePackId('__pro__')}>
                            <MaterialIcons name="lock" size={10} color={THEME.primary} style={{ marginRight: 5 }} />
                            <Text style={[styles.categoryText, { color: THEME.primary }]}>PRO PACK</Text>
                          </TouchableOpacity>
                          {packs.map(pack => ( 
                            <TouchableOpacity key={pack.id} style={[styles.categoryPill, activePackId === pack.id && styles.categoryPillActive, pack.isPremium && proStyles.categoryPill]} onPress={() => { if (pack.isPremium) { setProModalVisible(true); return; } setActivePackId(pack.id); }}>
                              {pack.isPremium && <MaterialIcons name="lock" size={10} color={THEME.primary} style={{ marginRight: 5 }} />}
                              <Text style={[styles.categoryText, activePackId === pack.id && styles.categoryTextActive, pack.isPremium && { color: THEME.primary }]}>{pack.name}</Text>
                            </TouchableOpacity> 
                          ))}
                        </ScrollView>
                        {activePackId === '__pro__' ? (
                          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: isSmallScreen ? 6 : 12 }}>
                            <View style={proStyles.proToolsCard}>
                              <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: isSmallScreen ? 8 : 12, gap: isSmallScreen ? 8 : 12 }}>
                                {[{ icon: 'star', label: 'Premium Stickers' }, { icon: 'edit', label: 'Custom Sticker Request' }, { icon: 'tune', label: 'Advanced Color Control' }].map((tool) => (
                                  <View key={tool.label} style={proStyles.proToolItem}>
                                    <View style={proStyles.proToolIconBg}>
                                      <MaterialIcons name={tool.icon as any} size={isSmallScreen ? 12 : 14} color={THEME.primary} />
                                    </View>
                                    <Text style={proStyles.proToolLabel}>{tool.label}</Text>
                                  </View>
                                ))}
                              </View>
                              <View style={proStyles.proBadge}>
                                <MaterialIcons name="lock" size={isSmallScreen ? 10 : 12} color={THEME.primary} style={{ marginRight: 4 }} />
                                <Text style={proStyles.proBadgeText}>Coming Soon Acchu Kannada Pro</Text>
                              </View>
                            </View>
                          </View>
                        ) : (
                          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                            {packs.find(p => p.id === activePackId)?.stickers.map((sticker, idx) => {
                              const previewColor = sticker.isTintable ? COLOR_PALETTE[idx % COLOR_PALETTE.length] : undefined;
                              return (
                              <TouchableOpacity key={sticker.id} style={{ width: '47%', aspectRatio: 1, backgroundColor: 'transparent', borderRadius: 16, justifyContent: 'center', alignItems: 'center' }} onPress={() => { 
                                commitHistory(prev => [...prev, { id: Date.now().toString(), type: 'image', src: sticker.src, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, isTintable: sticker.isTintable, color: sticker.isTintable ? previewColor : undefined }]); 
                                setSelectedId(null); 
                              }}>
                                <Image source={{ uri: sticker.src }} style={[{ width: '75%', height: '75%' }, sticker.isTintable && previewColor ? { tintColor: previewColor } : null]} resizeMode="contain" />
                              </TouchableOpacity>
                              );
                            })}
                            </View>
                          </ScrollView> 
                        )}
                        </>)}
                      </View> 
                    )}

                    {activeTab === 'text' && ( 
                      <View style={{flex: 1}}>
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
                                        shadowDistance: preset.shadowDistance, shadowAngle: 45, shadowOpacity: preset.shadowOpacity 
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
                            
                            {textSubTab === 'fonts' && (
                              <View style={{ flex: 1 }}>
                                <View style={{ height: 38, marginBottom: 8 }}>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 2, gap: 8 }}>
                                    {fontCategories.map((cat: FontCategory) => {
                                      const isActive = activeFontCategoryId === cat.id;
                                      const isPro = cat.id === 'acchu_pro';
                                      return (
                                        <TouchableOpacity 
                                          key={cat.id} 
                                          onPress={() => {
                                            if (isPro) { setProModalVisible(true); return; }
                                            setActiveFontCategoryId(cat.id);
                                          }}
                                          style={{ height: 34, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 17, borderWidth: isActive ? 0 : 1.5, borderColor: isPro ? 'rgba(221,198,22,0.3)' : '#3a3b3e', backgroundColor: isActive ? THEME.primary : isPro ? 'rgba(221,198,22,0.08)' : 'transparent' }}
                                        >
                                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            {isPro && <MaterialIcons name="lock" size={10} color={THEME.primary} style={{ marginRight: 4 }} />}
                                            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', color: isActive ? THEME.bgBase : isPro ? THEME.primary : THEME.textMain }}>{cat.name}</Text>
                                          </View>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </ScrollView>
                                </View>
                                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                                  {fontCategories.find(c => c.id === activeFontCategoryId)?.fonts.map((font: any) => (
                                    <TouchableOpacity 
                                      key={font.value} 
                                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, marginBottom: 4, borderRadius: 12, backgroundColor: activeTextEl.fontFamily === font.value ? 'rgba(221, 198, 22, 0.15)' : 'transparent' }}
                                      onPress={() => {
                                        if (font.isPremium) { setProModalVisible(true); return; }
                                        updateStyleWithHistory('fontFamily', font.value);
                                      }}
                                    >
                                      {font.isPremium && <MaterialIcons name="lock" size={12} color={THEME.primary} style={{ marginRight: 8 }} />}
                                      <Text style={{ fontFamily: font.value, fontSize: 18, color: activeTextEl.fontFamily === font.value ? THEME.primary : THEME.textMain, flex: 1 }}>
                                        {activeTextEl.content ? activeTextEl.content.substring(0, 20) : font.label}
                                      </Text>
                                      <Text style={{ fontSize: 10, color: THEME.textMuted }}>{font.label}</Text>
                                      {activeTextEl.fontFamily === font.value && <MaterialIcons name="check-circle" size={16} color={THEME.primary} style={{ marginLeft: 8 }} />}
                                    </TouchableOpacity>
                                  ))}
                                </ScrollView>
                              </View>
                            )}

                            {textSubTab === 'style' && ( 
                              <ScrollView style={styles.advancedMenu} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
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
                                <ProSlider icon="text-fields" label="Font Size" value={activeTextEl.fontSize || 45} min={15} max={120} step={1} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('fontSize', v)} onComplete={handleSliderComplete} />
                                <ProSlider icon="open-with" label="Letter Spacing" value={activeTextEl.letterSpacing || 0} min={-5} max={30} step={1} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('letterSpacing', v)} onComplete={handleSliderComplete} />
                                <ProSlider icon="menu" label="Line Height" value={activeTextEl.lineHeight || 65} min={20} max={150} step={1} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('lineHeight', v)} onComplete={handleSliderComplete} />
                              </ScrollView> 
                            )}
                            {textSubTab === 'effects' && ( 
                              <ScrollView style={styles.advancedMenu} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                                <Text style={[styles.sectionTitle]}>Shadow Drop</Text><ProSlider icon="wb-sunny" label="Blur Radius" value={activeTextEl.shadowBlur || 0} min={0} max={30} step={1} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowBlur', v)} onComplete={handleSliderComplete} /><ProSlider icon="open-in-full" label="Distance" value={activeTextEl.shadowDistance || 0} min={0} max={50} step={1} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowDistance', v)} onComplete={handleSliderComplete} /><ProSlider icon="explore" label="Light Angle" value={activeTextEl.shadowAngle || 45} min={0} max={360} step={1} displayValue={`${activeTextEl.shadowAngle || 45}°`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowAngle', v)} onComplete={handleSliderComplete} /><ProSlider icon="visibility" label="Shadow Opacity" value={activeTextEl.shadowOpacity || 0} min={0} max={1} step={0.1} displayValue={`${Math.round((activeTextEl.shadowOpacity || 0) * 100)}%`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('shadowOpacity', v)} onComplete={handleSliderComplete} />
                                <ProSlider icon="layers" label="Text Opacity" value={activeTextEl.opacity || 1} min={0.1} max={1} step={0.1} displayValue={`${Math.round((activeTextEl.opacity || 1) * 100)}%`} onStart={handleSliderStart} onChange={(v:number) => updateSelectedStyle('opacity', v)} onComplete={handleSliderComplete} />
                              </ScrollView> 
                            )}
                            {textSubTab === 'pro' && (
                              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: isSmallScreen ? 6 : 12 }}>
                                <View style={proStyles.proToolsCard}>
                                  <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: isSmallScreen ? 8 : 12, gap: isSmallScreen ? 8 : 12 }}>
                                    {[{ icon: 'cloud-upload', label: 'Premium Fonts' }, { icon: 'water-drop', label: 'Gradients' }, { icon: 'layers', label: 'Outlines' }].map((tool) => (
                                      <View key={tool.label} style={proStyles.proToolItem}>
                                        <View style={proStyles.proToolIconBg}>
                                          <MaterialIcons name={tool.icon as any} size={isSmallScreen ? 12 : 14} color={THEME.primary} />
                                        </View>
                                        <Text style={proStyles.proToolLabel}>{tool.label}</Text>
                                      </View>
                                    ))}
                                  </View>
                                  <View style={proStyles.proBadge}>
                                    <MaterialIcons name="lock" size={isSmallScreen ? 10 : 12} color={THEME.primary} style={{ marginRight: 4 }} />
                                    <Text style={proStyles.proBadgeText}>Coming Soon Acchu Kannada Pro</Text>
                                  </View>
                                </View>
                              </View>
                            )}
                            {textSubTab === 'color' && ( 
                              <ScrollView style={styles.advancedMenu} showsVerticalScrollIndicator={false}>
                                <View style={styles.colorTargetRow}><TouchableOpacity style={[styles.colorTargetBtn, colorTarget === 'color' && styles.colorTargetBtnActive]} onPress={() => setColorTarget('color')}><Text style={[styles.colorTargetText, colorTarget === 'color' && styles.colorTargetTextActive]}>Text Body</Text></TouchableOpacity><TouchableOpacity style={[styles.colorTargetBtn, colorTarget === 'shadowColor' && styles.colorTargetBtnActive]} onPress={() => setColorTarget('shadowColor')}><Text style={[styles.colorTargetText, colorTarget === 'shadowColor' && styles.colorTargetTextActive]}>Shadow</Text></TouchableOpacity></View>
                                <View style={styles.colorPaletteGrid}>{COLOR_PALETTE.map((color) => { const isActive = activeTextEl[colorTarget] === color; return ( <TouchableOpacity key={color} style={[styles.colorGridSwatch, { backgroundColor: color, borderColor: isActive ? THEME.textMain : 'transparent' }]} onPress={() => updateStyleWithHistory(colorTarget, color)} /> ); })}</View>
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
                placeholder="ಪಠ್ಯ ಸೇರಿಸಿ..." 
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

              <Text style={{ position: 'absolute', bottom: safeBottom + 30, color: THEME.textMuted, fontSize: 11, letterSpacing: 0.5 }}>ಅಚ್ಚು ಕನ್ನಡ · Acchu Kannada Pro</Text>
            </View>
          )}

          {exportUri && (
            <View style={styles.exportOverlay}>
              <View style={[styles.exportHeader, { paddingTop: safeTop + 8 }]}>
                <TouchableOpacity onPress={() => setExportUri(null)}><MaterialIcons name="close" size={28} color={THEME.textMain} /></TouchableOpacity>
                <Text style={styles.exportTitle}>Your Creation</Text>
                <View style={{width: 28}} />
              </View>
              
              <Image source={{ uri: exportUri }} style={styles.exportPreviewImage} resizeMode="contain" />
              
              <View style={[styles.exportActionContainer, { paddingBottom: safeBottom + 20 }]}>
                <TouchableOpacity style={styles.exportPrimaryBtn} onPress={saveToGallery}>
                  <MaterialIcons name="save" size={20} color={THEME.bgBase} style={{marginRight: 10}} />
                  <Text style={styles.exportPrimaryBtnText}>Save to Gallery</Text>
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
                <Text style={[proStyles.title, { fontSize: 22 }]}>Saved! 🎉</Text>
                <Text style={[proStyles.desc, { marginBottom: 16 }]}>Image beautifully saved to your gallery</Text>
                
                <View style={{ backgroundColor: THEME.bgBase, borderRadius: 16, padding: 16, width: '100%', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(221, 198, 22, 0.2)' }}>
                  <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: '500', marginBottom: 8, letterSpacing: 0.5 }}>Tag us on social media</Text>
                  <Text style={{ color: THEME.primary, fontSize: 18, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 }}>@acchukannada</Text>
                  <View style={{ width: 40, height: 1, backgroundColor: 'rgba(221, 198, 22, 0.3)', marginBottom: 10 }} />
                  <Text style={{ color: THEME.textMain, fontSize: 22, fontFamily: 'Padyakke', textAlign: 'center', letterSpacing: 1 }}>ಜೈ ಕನ್ನಡ</Text>
                  <Text style={{ color: THEME.textMuted, fontSize: 11, fontFamily: 'ATSSmooth', marginTop: 4, letterSpacing: 0.8 }}>jai kannada</Text>
                </View>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                  <Text style={{ color: THEME.textMuted, fontSize: 11 }}>Use </Text>
                  <Text style={{ color: THEME.primary, fontSize: 12, fontWeight: '700' }}>#acchukannada</Text>
                </View>
                
                <TouchableOpacity style={proStyles.btn} onPress={() => setSaveSuccessVisible(false)}>
                  <Text style={proStyles.btnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal
        visible={proModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setProModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setProModalVisible(false)}>
          <View style={proStyles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={proStyles.modalCard}>
                <View style={proStyles.iconWrap}>
                  <MaterialIcons name="lock" size={28} color={THEME.primary} />
                </View>
                <Text style={proStyles.title}>Acchu Kannada Pro</Text>
                <Text style={proStyles.desc}>Premium content is coming soon! Stay tuned for exclusive fonts and sticker packs.</Text>
                <TouchableOpacity style={proStyles.btn} onPress={() => setProModalVisible(false)}>
                  <Text style={proStyles.btnText}>Got it</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal
        visible={crownModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setCrownModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setCrownModalVisible(false)}>
          <View style={proStyles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[proStyles.modalCard, { maxWidth: isSmallScreen ? 300 : 360 }]}>
                <View style={proStyles.iconWrap}>
                  <MaterialIcons name="emoji-events" size={32} color={THEME.primary} />
                </View>
                <Text style={proStyles.title}>Acchu Kannada Pro</Text>
                <Text style={[proStyles.desc, { marginBottom: 18 }]}>All premium features coming soon</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: isSmallScreen ? 8 : 12, marginBottom: isSmallScreen ? 14 : 20 }}>
                  {[{ icon: 'text-fields', label: 'Premium Fonts' }, { icon: 'star', label: 'Premium Stickers' }, { icon: 'image', label: 'Premium Filters' }, { icon: 'tune', label: 'Color Grading' }, { icon: 'edit', label: 'Custom Sticker Request' }, { icon: 'equalizer', label: 'Advanced Color Control' }, { icon: 'camera', label: 'Camera Control' }, { icon: 'cancel', label: 'Remove Watermark' }].map((f) => (
                    <View key={f.label} style={{ alignItems: 'center', width: isSmallScreen ? 72 : 90 }}>
                      <View style={[proStyles.proToolIconBg, { width: isSmallScreen ? 36 : 44, height: isSmallScreen ? 36 : 44, borderRadius: isSmallScreen ? 18 : 22 }]}>
                        <MaterialIcons name={f.icon as any} size={isSmallScreen ? 16 : 20} color={THEME.primary} />
                      </View>
                      <Text style={[proStyles.proToolLabel, { fontSize: isSmallScreen ? 8 : 10, marginTop: isSmallScreen ? 4 : 6 }]}>{f.label}</Text>
                    </View>
                  ))}
                </View>
                <View style={proStyles.proBadge}>
                  <MaterialIcons name="lock" size={14} color={THEME.primary} style={{ marginRight: 6 }} />
                  <Text style={proStyles.proBadgeText}>Coming Soon Acchu Kannada Pro</Text>
                </View>
                <TouchableOpacity style={[proStyles.btn, { marginTop: 16 }]} onPress={() => setCrownModalVisible(false)}>
                  <Text style={proStyles.btnText}>Got it</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  splashContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SAFE_HORIZONTAL_PADDING }, mainLogoImage: { width: 185, height: 185, marginBottom: 30 }, splashTitle: { color: THEME.textMain, fontSize: 28, fontFamily: 'Padyakke', textAlign: 'center', marginBottom: 10 },
  splashFooter: { position: 'absolute', bottom: 60, alignItems: 'center', width: '100%' }, splashSubtitle: { color: THEME.textMuted, fontSize: 13, fontFamily: 'ATSSmooth', letterSpacing: 1, textAlign: 'center', marginBottom: 16 }, splashVersion: { color: 'rgba(255,255,255,0.25)', fontSize: 11, fontFamily: 'ATSSmooth', letterSpacing: 2, marginBottom: 4 }, splashCopyright: { color: 'rgba(255,255,255,0.15)', fontSize: 10, fontFamily: 'ATSSmooth', textAlign: 'center' },
  primaryBtn: { flexDirection: 'row', backgroundColor: THEME.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 20, alignItems: 'center', elevation: 1 }, primaryBtnText: { color: '#000000', fontWeight: '600', fontSize: 15, letterSpacing: 0.3 },
  headerSafeArea: { backgroundColor: THEME.bgSurface }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SAFE_HORIZONTAL_PADDING, height: HEADER_HEIGHT }, iconBtn: { padding: 10, borderRadius: 20 }, headerTitle: { color: THEME.textMain, fontSize: 16, fontWeight: '500', letterSpacing: 1, textTransform: 'uppercase' }, exportBtn: { padding: 10 },
  canvasContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000' }, viewShot: { overflow: 'hidden', backgroundColor: '#000000' }, draggable: { position: 'absolute', zIndex: 100 }, stickerImage: { width: 100, height: 100 },
  resizeHandleSquare: { position: 'absolute', width: 10, height: 10, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: THEME.boundingBox, borderRadius: 2, zIndex: 200 }, rotateHandleCircle: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: THEME.boundingBox, zIndex: 200 },
  bottomPanelWrapper: { backgroundColor: THEME.bgSurface }, bottomArea: { backgroundColor: THEME.bgSurface, paddingTop: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  dragHandle: { width: 32, height: 4, borderRadius: 2, backgroundColor: '#4a4b4e', alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  cropGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, width: '100%' }, cropBtn: { width: '30%', height: 60, backgroundColor: THEME.bgSurfaceHigh, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'transparent' }, cropBtnActive: { borderColor: THEME.primary, backgroundColor: 'rgba(221, 198, 22, 0.1)' }, cropBtnText: { color: THEME.textMain, fontWeight: '600', fontSize: 13 }, cropBtnTextActive: { color: THEME.primary }, cropSub: { color: THEME.textMuted, fontSize: 9, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  cropPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.bgSurfaceHigh, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#3a3b3e' }, cropPillActive: { backgroundColor: THEME.primary, borderColor: THEME.primary }, cropPillText: { color: THEME.textMuted, fontSize: 12, fontWeight: '600' }, cropPillTextActive: { color: '#000000' },
  segmentedControl: { flexDirection: 'row', backgroundColor: THEME.bgSurface, paddingVertical: 2, paddingBottom: 6 }, segmentBtn: { flex: 1, flexDirection: 'column', paddingVertical: 6, alignItems: 'center', justifyContent: 'center' }, segmentBtnActive: { }, segmentText: { color: THEME.textMuted, fontWeight: '500', fontSize: 10, marginTop: 3, letterSpacing: 0.5 }, segmentTextActive: { color: THEME.primary },
  navIndicator: { paddingHorizontal: 20, paddingVertical: 4, borderRadius: 16 }, navIndicatorActive: { backgroundColor: 'rgba(221, 198, 22, 0.15)' },
  tabContent: { height: BOTTOM_PANEL_HEIGHT - 70, paddingHorizontal: SAFE_HORIZONTAL_PADDING, paddingTop: 12 }, categoryRow: { flexDirection: 'row', marginBottom: 12, maxHeight: 32 }, categoryPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, marginRight: 8, backgroundColor: THEME.bgSurfaceHigh, borderWidth: 1, borderColor: '#3a3b3e' }, categoryPillActive: { backgroundColor: THEME.primary, borderColor: THEME.primary }, categoryText: { color: THEME.textMuted, fontSize: 11, fontWeight: '600' }, categoryTextActive: { color: '#000000' },
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
  proSliderWrapper: { marginBottom: 4, paddingHorizontal: 2 }, proSliderHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: -2 }, proSliderLabel: { color: THEME.textMuted, fontSize: 11, flex: 1, fontWeight: '500', letterSpacing: 0.3 }, proSliderValue: { color: THEME.textMain, fontSize: 11, fontWeight: '600' }, sliderControl: { width: '100%', height: 35 },
  
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
  btnText: { color: '#000000', fontSize: 15, fontWeight: '600' as const, letterSpacing: 0.3 },

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