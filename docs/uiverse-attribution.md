# Uiverse interface details

The elements below were opened and their rendered CSS editors inspected on October 21, 2026. Each element page displays the MIT license. These are local adaptations; the app does not load Uiverse scripts, assets or tracking code.

| Adaptation | Original element and author | Changes for Research Atlas |
| --- | --- | --- |
| Button hover and press feedback | [Button: evil-monkey-41](https://uiverse.io/cssbuttons-io/evil-monkey-41), [cssbuttons-io](https://uiverse.io/profile/cssbuttons-io) | Adapted the raised-front transform, easing and quick press response to existing `.button` and `.research-send` elements. Reduced travel to 1px, kept the app's colors, removed layered spans, gradients and brightness filters. Added disabled and reduced-motion handling. |
| Static dotted surface | [Pattern: short-warthog-33](https://uiverse.io/kennyotsu/short-warthog-33), [kennyotsu / kotsu](https://uiverse.io/profile/kennyotsu) | Adapted the radial dot grid to 0.8px dots on a 20px grid with lower contrast. Used only on bounded loading panels or surfaces explicitly given `.atlas-dot-surface`. |
| Compact loading indicator | [Loader: ugly-bulldog-75](https://uiverse.io/satyamchaudharydev/ugly-bulldog-75), [satyamchaudharydev / satyam](https://uiverse.io/profile/satyamchaudharydev) | Adapted staggered `scaleY` bars from five bright 50px bars to three muted 12px bars. Slower timing, opacity modulation, accessible status text, static reduced-motion presentation, and no blocking overlay. |

Implementation: `app/interface-details.css` and `app/loading-state.tsx`.

## Original CSS excerpts adapted

From cssbuttons-io's button:

```css
.front {
  transform: translateY(-4px);
  transition: transform 600ms cubic-bezier(.3, .7, .4, 1);
}
button:hover .front {
  transform: translateY(-6px);
  transition: transform 250ms cubic-bezier(.3, .7, .4, 1.5);
}
button:active .front {
  transform: translateY(-2px);
  transition: transform 34ms;
}
```

From kennyotsu's pattern:

```css
.container {
  width: 100%;
  height: 100%;
  /* Add your background pattern here */
  background-color: #313131;
  background-image: radial-gradient(rgba(255, 255, 255, 0.171) 2px, transparent 0);
  background-size: 30px 30px;
  background-position: -5px -5px
}
```

From satyamchaudharydev's loader:

```css
.loading span {
  width: 4px;
  height: 50px;
  background: var(--first-color);
  animation: scale var(--speed-of-animation) ease-in-out infinite;
}
.loading span:nth-child(2) { animation-delay: -0.8s; }
.loading span:nth-child(3) { animation-delay: -0.7s; }
@keyframes scale {
  0%, 40%, 100% { transform: scaleY(0.05); }
  20% { transform: scaleY(1); }
}
```

## Copyright notices

The following notices are preserved as displayed on the original element pages. The common MIT permission and warranty terms below apply to each of these notices and to the corresponding adapted portions.

Copyright - 2026 cssbuttons-io (cssbuttons.io)

Copyright - 2026 kennyotsu (kotsu)

Copyright - 2026 satyamchaudharydev (satyam)

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Integration

Import `app/interface-details.css` after the app's base stylesheet. Render `<LoadingState label="Searching free document providers…" compact />` inside an existing panel while its request is pending, or omit `compact` for a bounded section loading state. Unmount it when the request resolves. The component has no timers, progress claims, minimum display delay, or dependency on a third-party service.
