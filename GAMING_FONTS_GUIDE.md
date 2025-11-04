# 🎮 Gaming Fonts Guide for Gotchipus

## Available Gaming Font Classes

### **Retro/Pixel Fonts**
- `.font-pixel` - **Press Start 2P** - Classic 8-bit arcade style
- `.font-retro` - **VT323** - Terminal/retro computer style

### **Futuristic/Sci-Fi Fonts**
- `.font-futuristic` - **Orbitron** - Space-age, sci-fi style
- `.font-cyber` - **Exo 2** - Modern cyberpunk aesthetic
- `.font-audio` - **Audiowide** - Electronic/sound wave style

### **Military/Action Fonts**
- `.font-military` - **Rajdhani** - Military/tactical style
- `.font-army` - **Black Ops One** - Bold military action style
- `.font-bold-gaming` - **Russo One** - Strong gaming brand style

## Text Effects

### **Glow Effects**
- `.text-glow` - Soft glowing effect
- `.text-neon` - Bright neon glow
- `.text-outline` - Black outline for contrast
- `.text-3d` - 3D shadow effect

### **Animations**
- `.animate-float` - Gentle floating animation
- `.animate-pulse-glow` - Pulsing glow effect
- `.animate-text-flicker` - Retro flickering effect

## Usage Examples

```html
<!-- Main Title -->
<h1 class="font-pixel pixel-gradient-text animate-float text-glow">
  GOTCHIPUS
</h1>

<!-- Futuristic Headers -->
<h2 class="font-futuristic text-neon">
  SPACE COMMAND
</h2>

<!-- Military Style -->
<h3 class="font-military text-outline">
  TACTICAL OPERATIONS
</h3>

<!-- Cyberpunk Text -->
<p class="font-cyber animate-pulse-glow">
  Neural interface activated...
</p>

<!-- Retro Terminal -->
<code class="font-retro text-glow">
  > system_online
</code>
```

## Font Combinations by Game Genre

### **Retro Arcade Games**
- Headers: `font-pixel` + `text-glow`
- Body: `font-retro`
- Effects: `animate-float`, `animate-text-flicker`

### **Sci-Fi/Space Games**
- Headers: `font-futuristic` + `text-neon`
- UI: `font-cyber`
- Effects: `animate-pulse-glow`

### **Military/Action Games**
- Headers: `font-military` + `text-outline`
- UI: `font-army`
- Effects: `text-3d`

### **Cyberpunk Games**
- Headers: `font-audio` + `text-neon`
- UI: `font-cyber`
- Effects: `animate-pulse-glow`, `text-glow`

## Implementation Tips

1. **Mix and Match**: Combine different fonts for hierarchy
2. **Use Effects Sparingly**: Too many effects can be overwhelming
3. **Consider Readability**: Ensure text remains legible
4. **Test on Different Screens**: Fonts may render differently
5. **Performance**: Google Fonts are optimized for web use

## Customization

You can modify the fonts in `src/index.css`:
- Change font families
- Adjust letter spacing
- Modify text effects
- Create new combinations

## Browser Support

All fonts are web-optimized and support:
- Chrome, Firefox, Safari, Edge
- Mobile browsers
- High DPI displays
- Variable font features (where available)
