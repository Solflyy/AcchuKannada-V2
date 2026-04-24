// UPDATED SCRIPT
const fs = require('fs');
const content = fs.readFileSync('App.tsx', 'utf8');
const lines = content.split('\n');

// Replace lines 3721 (index) to 3883 (index) = lines 3722 to 3884 (1-based)
const START = 3721; // 0-based: line 3722 = index 3721
const END   = 3883; // 0-based: line 3884 = index 3883, we keep this line (the '}')

const newBlock = [
`          {/* \u2500\u2500 Settings panel (WB + Pro tools) \u2500\u2500 */}`,
`          {camShowSettings && (`,
`            <View style={{ position: 'absolute', top: safeTop + 62, right: 12, backgroundColor: 'rgba(15,15,15,0.93)', borderRadius: 18, padding: 16, width: 236, maxHeight: height * 0.55, zIndex: 20 }}>`,
`              <ScrollView showsVerticalScrollIndicator={false}>`,
`                {/* White Balance */}`,
`                <Text style={{ color: '#888', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8, textTransform: 'uppercase' }}>White Balance</Text>`,
`                <View style={{ flexDirection: 'row', gap: 5, marginBottom: 16, flexWrap: 'wrap' }}>`,
`                  {([`,
`                    { id: 'auto' as const, label: 'Auto', icon: 'wb-auto' },`,
`                    { id: 'sunny' as const, label: 'Day', icon: 'wb-sunny' },`,
`                    { id: 'cloudy' as const, label: 'Cloud', icon: 'wb-cloudy' },`,
`                    { id: 'shadow' as const, label: 'Shade', icon: 'wb-shade' },`,
`                    { id: 'fluorescent' as const, label: 'Fluo', icon: 'wb-iridescent' },`,
`                    { id: 'incandescent' as const, label: 'Tung', icon: 'wb-incandescent' },`,
`                  ] as const).map(wb => (`,
`                    <TouchableOpacity key={wb.id} onPress={() => { if (!isPro && wb.id !== 'auto') { requirePro(); return; } setCamWB(wb.id); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: camWB === wb.id ? 'rgba(221,198,22,0.2)' : 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: camWB === wb.id ? THEME.primary : 'transparent' }}>`,
`                      <MaterialIcons name={wb.icon as any} size={13} color={camWB === wb.id ? THEME.primary : '#aaa'} />`,
`                      <Text style={{ color: camWB === wb.id ? THEME.primary : '#aaa', fontSize: 10, fontWeight: '600', marginLeft: 3 }}>{wb.label}</Text>`,
`                    </TouchableOpacity>`,
`                  ))}`,
`                </View>`,
`                {/* Pro tools */}`,
`                <Text style={{ color: '#888', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8, textTransform: 'uppercase' }}>Pro Tools {!isPro ? '\uD83D\uDD12' : ''}</Text>`,
`                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>`,
`                  {[`,
`                    { key: 'hdr', label: 'HDR', icon: 'hdr-on', active: camHDR, onPress: () => { if (!isPro) { requirePro(); return; } setCamHDR(v => !v); } },`,
`                    { key: 'level', label: 'Level', icon: 'straighten', active: camLevelEnabled, onPress: () => { if (!isPro) { requirePro(); return; } setCamLevelEnabled(v => !v); } },`,
`                    { key: 'hist', label: 'Histogram', icon: 'equalizer', active: camHistogram, onPress: () => { if (!isPro) { requirePro(); return; } setCamHistogram(v => !v); } },`,
`                  ].map(t => (`,
`                    <TouchableOpacity key={t.key} onPress={t.onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: t.active ? 'rgba(221,198,22,0.2)' : 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: t.active ? THEME.primary : 'transparent' }}>`,
`                      <MaterialIcons name={t.icon as any} size={14} color={t.active ? THEME.primary : '#aaa'} />`,
`                      <Text style={{ color: t.active ? THEME.primary : '#aaa', fontSize: 10, fontWeight: '600', marginLeft: 4 }}>{t.label}</Text>`,
`                    </TouchableOpacity>`,
`                  ))}`,
`                </View>`,
`              </ScrollView>`,
`            </View>`,
`          )}`,
``,
`          {/* \u2500\u2500 Bottom controls \u2500\u2500 */}`,
`          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.78)', paddingBottom: safeBottom + 8 }}>`,
``,
`            {/* Composition guides row */}`,
`            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 7, paddingTop: 10, paddingBottom: 4 }}>`,
`              {[`,
`                { key: 'grid', icon: 'grid-on', label: 'Grid', active: camGrid, onPress: () => setCamGrid(v => !v) },`,
`                { key: 'golden', icon: 'filter-center-focus', label: 'Golden', active: camGolden, onPress: () => setCamGolden(v => !v) },`,
`                { key: 'spiral', icon: 'filter-tilt-shift', label: 'Spiral', active: camSpiral, onPress: () => setCamSpiral(v => !v) },`,
`              ].map(g => (`,
`                <TouchableOpacity key={g.key} onPress={g.onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 5, borderRadius: 16, backgroundColor: g.active ? 'rgba(221,198,22,0.18)' : 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: g.active ? THEME.primary + '60' : 'rgba(255,255,255,0.12)' }}>`,
`                  <MaterialIcons name={g.icon as any} size={13} color={g.active ? THEME.primary : '#ccc'} />`,
`                  <Text style={{ color: g.active ? THEME.primary : '#ccc', fontSize: 10, fontWeight: '600', marginLeft: 4 }}>{g.label}</Text>`,
`                </TouchableOpacity>`,
`              ))}`,
`              {camSpiral && (`,
`                <TouchableOpacity onPress={() => setCamSpiralRotation(r => (r + 90) % 360)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: 'rgba(221,198,22,0.1)', borderWidth: 1, borderColor: THEME.primary + '40' }}>`,
`                  <MaterialIcons name="rotate-right" size={13} color={THEME.primary} />`,
`                  <Text style={{ color: THEME.primary, fontSize: 10, fontWeight: '600', marginLeft: 3 }}>{camSpiralRotation}\u00b0</Text>`,
`                </TouchableOpacity>`,
`              )}`,
`            </View>`,
``,
`            {/* Zoom strip \u2014 always visible */}`,
`            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5, paddingVertical: 8 }}>`,
`              {([`,
`                { label: '1\u00d7', value: 0 },`,
`                { label: '2\u00d7', value: 0.143 },`,
`                { label: '3\u00d7', value: 0.286 },`,
`                { label: '5\u00d7', value: 0.571 },`,
`                { label: '8\u00d7', value: 1 },`,
`              ] as const).map(z => {`,
`                const isActive = Math.abs(camZoom - z.value) < 0.05;`,
`                return (`,
`                  <TouchableOpacity key={z.label} onPress={() => setCamZoom(z.value)} style={{ paddingHorizontal: 15, paddingVertical: 7, borderRadius: 20, backgroundColor: isActive ? THEME.primary : 'rgba(255,255,255,0.1)', borderWidth: isActive ? 0 : 1, borderColor: 'rgba(255,255,255,0.15)' }}>`,
`                    <Text style={{ color: isActive ? THEME.bgBase : '#fff', fontSize: 13, fontWeight: '800' }}>{z.label}</Text>`,
`                  </TouchableOpacity>`,
`                );`,
`              })}`,
`            </View>`,
``,
`            {/* Shutter row: gallery | shutter | ratio */}`,
`            <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', paddingTop: 4, paddingBottom: 6, paddingHorizontal: 32 }}>`,
`              {/* Gallery */}`,
`              <TouchableOpacity onPress={launchPicker} style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>`,
`                <MaterialIcons name="photo-library" size={24} color="#fff" />`,
`              </TouchableOpacity>`,
``,
`              {/* Shutter button */}`,
`              <TouchableOpacity onPress={takePictureWithTimer} disabled={cameraSaving || camTimerCountdown > 0} style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: 'rgba(255,255,255,0.85)', backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center' }}>`,
`                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: cameraSaving ? 'rgba(221,198,22,0.6)' : '#fff', opacity: (cameraSaving || camTimerCountdown > 0) ? 0.5 : 1 }} />`,
`              </TouchableOpacity>`,
``,
`              {/* Aspect ratio cycle */}`,
`              <TouchableOpacity onPress={() => setCamRatio(r => r === 'full' ? '4:3' : r === '4:3' ? '1:1' : r === '1:1' ? '16:9' : 'full')} style={{ width: 54, height: 54, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>`,
`                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 14 }}>{camRatio === 'full' ? 'FULL' : camRatio}</Text>`,
`              </TouchableOpacity>`,
`            </View>`,
`          </View>`,
``,
`          {/* \u2500\u2500 Captured photo preview \u2014 Retake / Use Photo \u2500\u2500 */}`,
`          {camCapturedPhoto && (`,
`            <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 50, justifyContent: 'center', alignItems: 'center' }}>`,
`              <Image source={{ uri: camCapturedPhoto.uri }} style={{ width: width, height: height * 0.78, resizeMode: 'contain' }} />`,
`              <View style={{ position: 'absolute', bottom: safeBottom + 28, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 16, paddingHorizontal: 36 }}>`,
`                <TouchableOpacity onPress={() => setCamCapturedPhoto(null)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', paddingVertical: 16, borderRadius: 18, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }}>`,
`                  <MaterialIcons name="replay" size={22} color="#fff" />`,
`                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Retake</Text>`,
`                </TouchableOpacity>`,
`                <TouchableOpacity onPress={sendCapturedToEditor} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.primary, paddingVertical: 16, borderRadius: 18, gap: 8 }}>`,
`                  <MaterialIcons name="check" size={22} color={THEME.bgBase} />`,
`                  <Text style={{ color: THEME.bgBase, fontSize: 15, fontWeight: '700' }}>Use Photo</Text>`,
`                </TouchableOpacity>`,
`              </View>`,
`            </View>`,
`          )}`,
];

const before = lines.slice(0, START);
const after = lines.slice(END); // keep END line onward
const newLines = [...before, ...newBlock, ...after];

fs.writeFileSync('App.tsx', newLines.join('\n'), 'utf8');
console.log('Done. Lines:', newLines.length);

// OLD SCRIPT BELOW - IGNORE
const x = 0;

// Find the exact line numbers (0-based)
let settingsStart = -1, capturedEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (settingsStart === -1 && lines[i].includes('{/* Settings panel */}')) settingsStart = i;
  if (lines[i].includes('{/* Captured photo preview')) {
    // Find the closing </View> for this block
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      const l = lines[j];
      for (const ch of l) { if (ch === '<') { if (l.includes('</')) {} } }
      // Count View opens/closes
      const opens = (l.match(/<View/g) || []).length;
      const closes = (l.match(/<\/View>/g) || []).length;
      depth += opens - closes;
      if (j > i && depth <= 0 && l.includes('</View>')) {
        // also skip the next line which has closing '}'
        capturedEnd = j + 1; // include the '}' line
        break;
      }
    }
    break;
  }
}
console.log('settingsStart (1-based):', settingsStart + 1);
console.log('capturedEnd (1-based):', capturedEnd + 1);
console.log('Line at settingsStart:', lines[settingsStart]);
console.log('Line at capturedEnd:', lines[capturedEnd]);
