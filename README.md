<<<<<<< Updated upstream
# AcchuKannada-V2
Acchu Kannada V2 apps Repository for storing every assets
=======
# Acchu Kannada

> ಕನ್ನಡ ಬಳಸಿ ಕನ್ನಡ ಉಳಿಸಿ — A Kannada Photo Editor

A professional photo editor built for the Kannada community. Add beautiful Kannada text, stickers, filters, and adjustments to your photos.

---

## Features

### Text Tool
- 30+ curated Kannada text presets
- 4 Kannada fonts — BLR Smooth, Hubballi, Noto Sans, Padyakke
- Full styling: font size (15–120px), letter spacing, line height, alignment
- Text color palette with 15 preset colors + custom color
- Drop shadow with adjustable blur, distance, angle, opacity, and color

### Filters
- 13 professional filter presets:
  - **Kodak**: Portra, Gold, Ektar
  - **Leica**: Classic, Vivid
  - **Canon**: Faithful, Portrait
  - **Vintage**: 70s, Fade, Sepia
  - **Konica**: Mono, Noir, Silver
- Adjustable filter strength slider

### Image Adjustments
- **Light**: Exposure, Contrast, Highlights, Shadows, Fade
- **Color**: Saturation, Vibrance, Temperature, Tint
- Powered by `react-native-color-matrix-image-filters` with proper 5×4 color matrices
- EV-style exposure (pow(2, exposure)), Rec.709 luminance-weighted saturation

### Stickers
- Multiple sticker packs loaded from cloud
- Color-tintable stickers with full palette
- Opacity control per sticker
- Layer ordering: move front/back, duplicate, delete

### Crop
- 7 aspect ratios: 1:1, 4:5, 16:9, 3:2, 9:16, 5:4, 2:3
- Rotate left/right (90° increments)
- Spiral grid overlay (toggle, rotate, flip)

### Canvas & Layers
- Drag, resize, rotate any element
- Width-resize handles on text elements
- Full undo/redo history
- Bounding box selection with visual guides

### Export
- High-quality PNG export (1.0 quality)
- Save to device gallery
- Share to social media
- Branded watermark

---

## Tech Stack

| Technology | Purpose |
|---|---|
| React Native 0.81 | Core framework |
| Expo SDK 54 | Build & development platform |
| TypeScript | Type safety |
| react-native-color-matrix-image-filters | Image adjustments (color matrices) |
| react-native-view-shot | Canvas capture/export |
| expo-image-picker | Photo selection from gallery |
| expo-media-library | Save to gallery |
| expo-sharing | Social media sharing |
| expo-font | Custom Kannada font loading |
| AsyncStorage | Response caching (24h TTL) |
| PanResponder | Gesture handling (drag, pinch, rotate) |
| EAS Build | Production AAB & APK builds |

---

## Project Structure

```
acchu-kannada-v2/
├── App.tsx                  # Entire app (single-file architecture)
├── app.json                 # Expo config (package, permissions, icons)
├── eas.json                 # EAS Build profiles
├── index.ts                 # Entry point
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── privacy-policy.md        # Privacy policy
├── PLAYSTORE-LISTING.md     # Play Store listing reference
├── generate-store-assets.js # Script to generate store graphics
├── assets/
│   ├── icon.png             # App icon (1024×1024)
│   ├── adaptive-icon.png    # Android adaptive icon
│   ├── splash-icon.png      # Splash screen icon
│   ├── favicon.png          # Web favicon
│   └── fonts/               # Local font files
└── store-assets/            # Generated Play Store graphics
    ├── icon-512.png
    ├── feature-graphic.png
    ├── screenshot-1..4.png
    └── tablet-screenshot-1..2.png
```

---

## Cloud Assets

All dynamic content is loaded from GitHub at runtime:

| Asset | URL |
|---|---|
| Sticker packs | `assets/stickers/sticker-packs.json` |
| Font list | `assets/fonts.json` |
| Splash text | `assets/splashText.json` |
| Text presets | `assets/textPresets.json` |
| Background | `assets/backgrounds/BG.webp` |
| Logo | `assets/logos/Achhu Kannada LOGO.png` |

Base URL: `https://raw.githubusercontent.com/Solflyy/AcchuKannada-V2/refs/heads/copilot/create-asset-directory/`

---

## Getting Started

### Prerequisites
- Node.js 18+
- Expo CLI
- EAS CLI (for builds)

### Development
```bash
# Install dependencies
npm install

# Start development server
npx expo start

# Run on Android
npx expo start --android
```

### Production Build
```bash
# Build production AAB (for Play Store)
npx eas build -p android --profile production

# Build preview APK (for testing)
npx eas build -p android --profile preview
```

### Generate Store Assets
```bash
node generate-store-assets.js
# Outputs to store-assets/ folder
```

---

## App Configuration

### Package Info
- **Package name:** `com.acchukannada.app`
- **Version:** 1.0.0
- **Version code:** 1
- **Min SDK:** Default (Expo SDK 54)

### Permissions
- `READ_MEDIA_IMAGES` — Select photos for editing
- `READ_EXTERNAL_STORAGE` — Access photos (Android < 13)
- `WRITE_EXTERNAL_STORAGE` — Save edited photos

### EAS Project
- **Project ID:** `75941a1a-38cb-43ec-aa0e-1a5d49dab0ca`
- **Slug:** `acchu-kannada-v2`
- **Owner:** `deepucava`

---

## Architecture Notes

- **Single-file app** — All components live in `App.tsx` (~1700+ lines)
- **Expo Go fallback** — `HAS_COLOR_MATRIX` flag detects if native color matrix module is available; falls back to colored View overlays in Expo Go
- **Stale closure fix** — `DraggableItem` uses `latestProps` ref pattern to prevent stale closures in PanResponder callbacks
- **Caching** — All network fetches are cached in AsyncStorage with 24-hour TTL
- **Image prefetch** — Sticker images are prefetched via `Image.prefetch()` for instant loading

---

## Developer

**Deepak Ram**
- Email: deepucava@gmail.com
- GitHub: [Solflyy](https://github.com/Solflyy)

---

## License

Private — All rights reserved.
>>>>>>> Stashed changes
