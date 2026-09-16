# -*- coding: utf-8 -*-
"""
Minimal, hand-rolled Tailwind-utility -> CSS generator, scoped to exactly
the classes this project's index.html actually uses. Built because the
production site depends on the Tailwind Play CDN (cdn.tailwindcss.com) at
runtime with zero fallback -- on a slow/blocked mobile connection the CDN
script fails to load, so every w-/h-/text-/flex- utility never applies and
the page renders at raw browser defaults (huge unstyled SVGs, no layout),
which is exactly the "zoomed in, can't see anything" symptom reported from
an installed phone app. This generates a static stylesheet so the site
never depends on that CDN again.

Run it from anywhere: `python3 tools/build-tailwind.py`. It reads
index.html at the repo root and (re)writes tailwind-build.css next to it.
Regenerate whenever new utility classes are added to the markup, and check
the "Unresolved classes" list it prints -- anything there that isn't
already a custom class defined in styles.css needs a new case adding to
compile_base() below.
"""
import os
import re, sys

SPACING = {
  '0': '0px', 'px': '1px', '0.5': '0.125rem', '1': '0.25rem', '1.5': '0.375rem',
  '2': '0.5rem', '2.5': '0.625rem', '3': '0.75rem', '3.5': '0.875rem', '4': '1rem',
  '5': '1.25rem', '6': '1.5rem', '7': '1.75rem', '8': '2rem', '9': '2.25rem',
  '10': '2.5rem', '11': '2.75rem', '12': '3rem', '14': '3.5rem', '16': '4rem',
  '20': '5rem', '24': '6rem', '28': '7rem', '32': '8rem', '36': '9rem',
  '40': '10rem', '44': '11rem', '48': '12rem', '52': '13rem', '56': '14rem',
  '60': '15rem', '64': '16rem', '72': '18rem', '80': '20rem', '96': '24rem',
}

# Standard Tailwind v3 color palette (only the colors this project uses).
COLORS = {
  'transparent': 'transparent', 'black': '#000000', 'white': '#ffffff',
  # Project's tailwind.config overrides slate-100..900 to reference
  # CSS custom properties (--slate-*) so they flip with the day/night
  # theme -- only 50 and 950 stay at Tailwind's stock hex.
  'slate': {50:'#f8fafc',100:'var(--slate-100)',200:'var(--slate-200)',300:'var(--slate-300)',400:'var(--slate-400)',500:'var(--slate-500)',600:'var(--slate-600)',700:'var(--slate-700)',800:'var(--slate-800)',900:'var(--slate-900)',950:'#020617'},
  'red': {50:'#fef2f2',100:'#fee2e2',200:'#fecaca',300:'#fca5a5',400:'#f87171',500:'#ef4444',600:'#dc2626',700:'#b91c1c',800:'#991b1b',900:'#7f1d1d',950:'#450a0a'},
  'amber': {50:'#fffbeb',100:'#fef3c7',200:'#fde68a',300:'#fcd34d',400:'#fbbf24',500:'#f59e0b',600:'#d97706',700:'#b45309',800:'#92400e',900:'#78350f',950:'#451a03'},
  'emerald': {50:'#ecfdf5',100:'#d1fae5',200:'#a7f3d0',300:'#6ee7b7',400:'#34d399',500:'#10b981',600:'#059669',700:'#047857',800:'#065f46',900:'#064e3b',950:'#022c22'},
  'teal': {50:'#f0fdfa',100:'#ccfbf1',200:'#99f6e4',300:'#5eead4',400:'#2dd4bf',500:'#14b8a6',600:'#0d9488',700:'#0f766e',800:'#115e59',900:'#134e4a',950:'#042f2e'},
  'cyan': {50:'#ecfeff',100:'#cffafe',200:'#a5f3fc',300:'#67e8f9',400:'#22d3ee',500:'#06b6d4',600:'#0891b2',700:'#0e7490',800:'#155e75',900:'#164e63',950:'#083344'},
  'blue': {50:'#eff6ff',100:'#dbeafe',200:'#bfdbfe',300:'#93c5fd',400:'#60a5fa',500:'#3b82f6',600:'#2563eb',700:'#1d4ed8',800:'#1e40af',900:'#1e3a8a',950:'#172554'},
  'pink': {50:'#fdf2f8',100:'#fce7f3',200:'#fbcfe8',300:'#f9a8d4',400:'#f472b6',500:'#ec4899',600:'#db2777',700:'#be185d',800:'#9d174d',900:'#831843',950:'#500724'},
  'rose': {50:'#fff1f2',100:'#ffe4e6',200:'#fecdd3',300:'#fda4af',400:'#fb7185',500:'#f43f5e',600:'#e11d48',700:'#be123c',800:'#9f1239',900:'#881337',950:'#4c0519'},
  # Project's CSS-variable-backed custom palettes (tailwind.config `extend`).
  'ocean': {950:'var(--ocean-950)',900:'var(--ocean-900)',850:'var(--ocean-850)',800:'var(--ocean-800)',700:'var(--ocean-700)'},
}

FONT_SIZE = {
  'xs': ('0.75rem', '1rem'), 'sm': ('0.875rem', '1.25rem'), 'base': ('1rem', '1.5rem'),
  'lg': ('1.125rem', '1.75rem'), 'xl': ('1.25rem', '1.75rem'), '2xl': ('1.5rem', '2rem'),
  '3xl': ('1.875rem', '2.25rem'), '4xl': ('2.25rem', '2.5rem'), '5xl': ('3rem', '1'),
  '6xl': ('3.75rem', '1'),
}

BREAKPOINTS = {'sm': 640, 'md': 768, 'lg': 1024, 'xl': 1280, '2xl': 1536}

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def color_value(color_name, shade, alpha=None):
    """Returns a CSS color string for e.g. color_name='cyan', shade=500, alpha=0.6"""
    c = COLORS.get(color_name)
    if c is None:
        return None
    val = c if isinstance(c, str) else c.get(shade)
    if val is None:
        return None
    if alpha is None:
        return val
    if val.startswith('var('):
        # Can't alpha-blend a CSS var at build time reliably across themes;
        # emit color-mix() which works with any value the var resolves to.
        return f'color-mix(in srgb, {val} {int(float(alpha)*100)}%, transparent)'
    if val.startswith('#'):
        r, g, b = hex_to_rgb(val)
        return f'rgba({r}, {g}, {b}, {alpha})'
    return val

def parse_color_class(rest):
    """rest is everything after the property prefix, e.g. 'cyan-500/20' or 'white' or 'ocean-900'."""
    alpha = None
    if '/' in rest:
        rest, alpha_s = rest.rsplit('/', 1)
        alpha = int(alpha_s) / 100
    if rest in ('black', 'white', 'transparent'):
        return color_value(rest, None, alpha)
    m = re.match(r'^([a-z]+)-(\d+)$', rest)
    if not m:
        return None
    name, shade = m.group(1), int(m.group(2))
    return color_value(name, shade, alpha)

rules = []  # list of (selector_without_dot_escaped, [decls], media_min_width_or_None)

def esc(cls):
    # CSS-escape characters Tailwind class names can contain: . / [ ] : % # etc.
    out = []
    for ch in cls:
        if ch.isalnum() or ch == '-' or ch == '_':
            out.append(ch)
        else:
            out.append('\\' + ch)
    return ''.join(out)

def add(cls, decls, media=None, pseudo=None, extra_selector_suffix=''):
    sel = '.' + esc(cls)
    if pseudo:
        sel += pseudo
    sel += extra_selector_suffix
    rules.append((sel, decls, media))

def compile_base(cls, base):
    """base = class without responsive/state prefix. Returns list of decls or None."""
    # Arbitrary value classes: prop-[value]
    m = re.match(r'^([a-zA-Z-]+)-\[(.+)\]$', base)
    if m:
        prop, val = m.group(1), m.group(2)
        val = val.replace('_', ' ')
        mapping = {
            'w': [('width', val)], 'h': [('height', val)], 'min-h': [('min-height', val)],
            'max-h': [('max-height', val)], 'max-w': [('max-width', val)],
            'border': [('border-width', val)], 'text': [('font-size', val)],
            'align': [('vertical-align', val)], 'top': [('top', val)], 'bottom': [('bottom', val)],
        }
        if prop in mapping:
            return mapping[prop]
        return None

    if base == 'block': return [('display', 'block')]
    if base == 'inline-block': return [('display', 'inline-block')]
    if base == 'flex': return [('display', 'flex')]
    if base == 'grid': return [('display', 'grid')]
    if base == 'hidden': return [('display', 'none')]
    if base == 'relative': return [('position', 'relative')]
    if base == 'absolute': return [('position', 'absolute')]
    if base == 'fixed': return [('position', 'fixed')]
    if base == 'sticky': return [('position', 'sticky')]
    if base == 'inset-0': return [('inset', '0')]
    if base == 'top-0': return [('top', '0')]
    if base in ('left-3', 'right-3', 'bottom-3', 'top-3'):
        side = base.split('-')[0]
        return [(side, '0.75rem')]
    m = re.match(r'^-(top|bottom|left|right)-(\d+)$', base)
    if m:
        side, n = m.group(1), m.group(2)
        v = SPACING.get(n)
        return [(side, f'-{v}')] if v else None
    m = re.match(r'^-(right|top)-1$', base)
    if m:
        return [(m.group(1), '-0.25rem')]
    m = re.match(r'^-(mt|mb|ml|mr|mx|my|m)-([\d.]+)$', base)
    if m and m.group(2) in SPACING:
        prop_map = {'mt': 'margin-top', 'mb': 'margin-bottom', 'ml': 'margin-left',
                    'mr': 'margin-right', 'mx': 'margin-inline', 'my': 'margin-block', 'm': 'margin'}
        v = SPACING[m.group(2)]
        return [(prop_map[m.group(1)], v == '0px' and '0px' or f'-{v}')]

    if base == 'flex-1': return [('flex', '1 1 0%')]
    if base == 'flex-col': return [('flex-direction', 'column')]
    if base == 'flex-row': return [('flex-direction', 'row')]
    if base == 'flex-wrap': return [('flex-wrap', 'wrap')]
    if base == 'items-center': return [('align-items', 'center')]
    if base == 'items-start': return [('align-items', 'flex-start')]
    if base == 'justify-between': return [('justify-content', 'space-between')]
    if base == 'justify-center': return [('justify-content', 'center')]
    if base == 'justify-start': return [('justify-content', 'flex-start')]
    if base == 'shrink-0': return [('flex-shrink', '0')]

    m = re.match(r'^grid-cols-(\d+)$', base)
    if m: return [('grid-template-columns', f'repeat({m.group(1)}, minmax(0, 1fr))')]
    m = re.match(r'^col-span-(\d+)$', base)
    if m: return [('grid-column', f'span {m.group(1)} / span {m.group(1)}')]
    if base == 'col-span-full': return [('grid-column', '1 / -1')]

    m = re.match(r'^gap-([\d.]+)$', base)
    if m and m.group(1) in SPACING: return [('gap', SPACING[m.group(1)])]
    m = re.match(r'^space-y-([\d.]+)$', base)
    if m and m.group(1) in SPACING:
        return [('__child_combinator__', f'> :not([hidden]) ~ :not([hidden]) {{ margin-top: {SPACING[m.group(1)]}; }}')]

    for prop, css in (('p','padding'),('px','padding-inline'),('py','padding-block'),
                       ('pt','padding-top'),('pb','padding-bottom'),('pl','padding-left'),('pr','padding-right'),
                       ('m','margin'),('mx','margin-inline'),('my','margin-block'),
                       ('mt','margin-top'),('mb','margin-bottom'),('ml','margin-left'),('mr','margin-right')):
        m = re.match(rf'^{prop}-([\d.]+)$', base)
        if m and m.group(1) in SPACING:
            return [(css, SPACING[m.group(1)])]
    if base == 'mx-auto': return [('margin-inline', 'auto')]
    if base == 'mt-auto': return [('margin-top', 'auto')]

    for prop, css in (('w','width'),('h','height'),('min-h','min-height'),('max-h','max-height')):
        m = re.match(rf'^{prop}-([\d.]+)$', base)
        if m and m.group(1) in SPACING:
            return [(css, SPACING[m.group(1)])]
    if base == 'w-full': return [('width', '100%')]
    if base == 'w-fit': return [('width', 'fit-content')]
    if base == 'w-auto': return [('width', 'auto')]
    if base == 'min-w-max': return [('min-width', 'max-content')]
    if base == 'h-full': return [('height', '100%')]
    if base == 'min-h-screen': return [('min-height', '100vh')]
    if base == 'max-w-xl': return [('max-width', '36rem')]
    if base == 'max-w-2xl': return [('max-width', '42rem')]
    if base == 'max-w-3xl': return [('max-width', '48rem')]
    if base == 'max-w-lg': return [('max-width', '32rem')]
    if base == 'max-w-md': return [('max-width', '28rem')]
    if base == 'max-w-7xl': return [('max-width', '80rem')]

    m = re.match(r'^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)$', base)
    if m:
        size, lh = FONT_SIZE[m.group(1)]
        return [('font-size', size), ('line-height', lh)]
    if base == 'text-left': return [('text-align', 'left')]
    if base == 'text-right': return [('text-align', 'right')]
    if base == 'text-center': return [('text-align', 'center')]

    weights = {'font-black':900,'font-extrabold':800,'font-bold':700,'font-semibold':600,'font-medium':500,'font-normal':400}
    if base in weights: return [('font-weight', str(weights[base]))]
    if base == 'font-mono': return [('font-family', "'JetBrains Mono', ui-monospace, monospace")]
    if base == 'font-sans': return [('font-family', "ui-sans-serif, system-ui, sans-serif")]

    if base == 'leading-none': return [('line-height', '1')]
    if base == 'leading-tight': return [('line-height', '1.25')]
    if base == 'leading-relaxed': return [('line-height', '1.625')]
    if base == 'tracking-tight': return [('letter-spacing', '-0.025em')]
    if base == 'tracking-wide': return [('letter-spacing', '0.025em')]
    if base == 'tracking-wider': return [('letter-spacing', '0.05em')]
    if base == 'tracking-widest': return [('letter-spacing', '0.1em')]
    if base == 'uppercase': return [('text-transform', 'uppercase')]
    if base == 'normal-case': return [('text-transform', 'none')]
    if base == 'tracking-normal': return [('letter-spacing', '0em')]
    if base == 'list-disc': return [('list-style-type', 'disc')]
    if base == 'list-inside': return [('list-style-position', 'inside')]
    if base == 'whitespace-nowrap': return [('white-space', 'nowrap')]

    if base.startswith('bg-'):
        v = parse_color_class(base[3:])
        return [('background-color', v)] if v else None
    if base.startswith('text-'):
        v = parse_color_class(base[5:])
        return [('color', v)] if v else None
    if base.startswith('border-') and re.match(r'^border-(black|white|transparent|[a-z]+-\d+)(/\d+)?$', base):
        v = parse_color_class(base[7:])
        return [('border-color', v)] if v else None
    if base.startswith('placeholder-'):
        v = parse_color_class(base[len('placeholder-'):])
        return [('__pseudo_element__::placeholder', f'{{ color: {v}; opacity: 1; }}')] if v else None
    if base.startswith('accent-'):
        v = parse_color_class(base[len('accent-'):])
        return [('accent-color', v)] if v else None
    if base.startswith('shadow-') and '/' in base and re.search(r'-\d+/\d+$', base):
        # shadow-color utilities (shadow-cyan-500/30) -- approximate as a glow.
        v = parse_color_class(base[len('shadow-'):])
        return [('--tw-shadow-color', v), ('box-shadow', '0 10px 25px -5px var(--tw-shadow-color), 0 8px 10px -6px var(--tw-shadow-color)')] if v else None

    if base == 'border': return [('border-width', '1px'), ('border-style', 'solid')]
    m = re.match(r'^border-(\d+)$', base)
    if m: return [('border-width', f'{m.group(1)}px'), ('border-style', 'solid')]
    if base == 'border-t': return [('border-top-width', '1px'), ('border-top-style', 'solid')]
    if base == 'border-b': return [('border-bottom-width', '1px'), ('border-bottom-style', 'solid')]
    if base == 'border-l': return [('border-left-width', '1px'), ('border-left-style', 'solid')]
    if base == 'border-collapse': return [('border-collapse', 'collapse')]

    radii = {'rounded':'0.25rem','rounded-md':'0.375rem','rounded-lg':'0.5rem','rounded-xl':'0.75rem','rounded-2xl':'1rem','rounded-3xl':'1.5rem','rounded-full':'9999px'}
    if base in radii: return [('border-radius', radii[base])]

    shadows = {
      'shadow-md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      'shadow-lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      'shadow-2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
    }
    if base in shadows: return [('box-shadow', shadows[base])]

    if base == 'overflow-hidden': return [('overflow', 'hidden')]
    if base == 'overflow-x-auto': return [('overflow-x', 'auto')]
    if base == 'overflow-y-auto': return [('overflow-y', 'auto')]
    if base == 'pointer-events-none': return [('pointer-events', 'none')]
    if base == 'cursor-pointer': return [('cursor', 'pointer')]

    if base == 'transform': return [('transform', 'translate(var(--tw-translate-x,0), var(--tw-translate-y,0)) scale(var(--tw-scale-x,1), var(--tw-scale-y,1))')]
    if base == 'transition': return [('transition-property', 'all'), ('transition-timing-function', 'cubic-bezier(0.4,0,0.2,1)'), ('transition-duration', '150ms')]
    if base == 'transition-colors': return [('transition-property', 'color, background-color, border-color'), ('transition-timing-function', 'cubic-bezier(0.4,0,0.2,1)'), ('transition-duration', '150ms')]
    if base == 'transition-transform': return [('transition-property', 'transform'), ('transition-timing-function', 'cubic-bezier(0.4,0,0.2,1)'), ('transition-duration', '150ms')]
    m = re.match(r'^duration-(\d+)$', base)
    if m: return [('transition-duration', f'{m.group(1)}ms')]
    if base == 'origin-top-left': return [('transform-origin', 'top left')]
    if base == 'scale-105': return [('transform', 'scale(1.05)')]
    m = re.match(r'^-translate-y-([\d.]+)$', base)
    if m and m.group(1) in SPACING:
        return [('transform', f'translateY(-{SPACING[m.group(1)]})')]
    m = re.match(r'^translate-y-([\d.]+)$', base)
    if m and m.group(1) in SPACING:
        return [('transform', f'translateY({SPACING[m.group(1)]})')]

    if base == 'outline-none': return [('outline', '2px solid transparent'), ('outline-offset', '2px')]
    m = re.match(r'^ring-(\d+)$', base)
    if m: return [('box-shadow', f'0 0 0 {m.group(1)}px var(--tw-ring-color, currentColor)')]
    m = re.match(r'^ring-([a-z]+-\d+)$', base)
    if m:
        v = parse_color_class(m.group(1))
        return [('--tw-ring-color', v)] if v else None

    if base == 'backdrop-blur-md': return [('backdrop-filter', 'blur(12px)'), ('-webkit-backdrop-filter', 'blur(12px)')]
    if base == 'blur-3xl': return [('filter', 'blur(64px)')]
    if base == 'filter': return [('filter', 'var(--tw-blur, none)')]

    m = re.match(r'^z-(\d+)$', base)
    if m: return [('z-index', m.group(1))]

    if base == 'group': return []  # marker class, no own styles

    if base == 'animate-ping':
        return [('animation', 'tw-ping 1s cubic-bezier(0,0,0.2,1) infinite')]
    if base == 'animate-pulse':
        return [('animation', 'tw-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite')]

    return None

VARIANT_RE = re.compile(r'^(sm|md|lg|xl|2xl|hover|focus|focus-within|focus-visible|group-hover|disabled|checked):(.+)$')

def compile_class(cls):
    """Returns list of (selector_suffix_or_pseudo, decls, media) for this exact class token."""
    media = None
    pseudo_chain = []
    remaining = cls
    while True:
        m = VARIANT_RE.match(remaining)
        if not m:
            break
        variant, remaining = m.group(1), m.group(2)
        if variant in BREAKPOINTS:
            media = BREAKPOINTS[variant]
        elif variant == 'group-hover':
            pseudo_chain.append('GROUPHOVER')
        else:
            pseudo_chain.append(':' + variant)
    decls = compile_base(remaining, remaining)
    if decls is None:
        return None
    return (cls, decls, media, pseudo_chain)

def render():
    out = []
    out.append('/* ============================================================\n')
    out.append('   Static Tailwind-utility build\n')
    out.append('   Auto-generated: covers exactly the utility classes used in\n')
    out.append('   index.html, replacing the Tailwind Play CDN <script> so the\n')
    out.append('   site never depends on a third-party runtime compiler again.\n')
    out.append('   Regenerate if new utility classes are added to the markup.\n')
    out.append('   ============================================================ */\n')
    # Tailwind v3's standard Preflight base reset, reproduced verbatim (this
    # is the same fixed, published stylesheet Tailwind ships -- not project-
    # specific, so it's safe to hand-copy rather than re-derive). Without
    # this, default browser margins/heading sizes/img sizing etc. show
    # through and cause exactly the "oversized / out of proportion" look.
    out.append('''*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb}
::before,::after{--tw-content:''}
html{line-height:1.5;-webkit-text-size-adjust:100%;-moz-tab-size:4;tab-size:4;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji"}
body{margin:0;line-height:inherit}
hr{height:0;color:inherit;border-top-width:1px}
abbr:where([title]){text-decoration:underline dotted}
h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}
a{color:inherit;text-decoration:inherit}
b,strong{font-weight:bolder}
code,kbd,samp,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:1em}
small{font-size:80%}
sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}
sub{bottom:-0.25em}
sup{top:-0.5em}
table{text-indent:0;border-color:inherit;border-collapse:collapse}
button,input,optgroup,select,textarea{font-family:inherit;font-size:100%;font-weight:inherit;line-height:inherit;color:inherit;margin:0;padding:0}
button,select{text-transform:none}
button,[type='button'],[type='reset'],[type='submit']{-webkit-appearance:button;background-color:transparent;background-image:none}
:-moz-focusring{outline:auto}
:-moz-ui-invalid{box-shadow:none}
progress{vertical-align:baseline}
::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}
[type='search']{-webkit-appearance:textfield;outline-offset:-2px}
::-webkit-search-decoration{-webkit-appearance:none}
::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}
summary{display:list-item}
blockquote,dl,dd,h1,h2,h3,h4,h5,h6,hr,figure,p,pre{margin:0}
fieldset{margin:0;padding:0}
legend{padding:0}
ol,ul,menu{list-style:none;margin:0;padding:0}
dialog{padding:0}
textarea{resize:vertical}
input::placeholder,textarea::placeholder{opacity:1;color:#9ca3af}
button,[role="button"]{cursor:pointer}
:disabled{cursor:default}
img,svg,video,canvas,audio,iframe,embed,object{display:block;vertical-align:middle}
img,video{max-width:100%;height:auto}
[hidden]{display:none}
''')
    out.append('@keyframes tw-ping { 75%, 100% { transform: scale(2); opacity: 0; } }\n')
    out.append('@keyframes tw-pulse { 50% { opacity: .5; } }\n')

    repo_root = os.path.join(os.path.dirname(__file__), '..')
    html = open(os.path.join(repo_root, 'index.html'), encoding='utf-8').read()
    classes = set()
    for m in re.finditer(r'class="([^"]*)"', html):
        for c in m.group(1).split():
            classes.add(c)

    by_media = {}  # media(int|None) -> list of css text lines
    unresolved = []
    for cls in sorted(classes):
        res = compile_class(cls)
        if res is None:
            unresolved.append(cls)
            continue
        _, decls, media, pseudo_chain = res
        if not decls:
            continue
        selector = '.' + esc(cls)
        if 'GROUPHOVER' in pseudo_chain:
            # .group:hover .group-hover\:text-cyan-300 { ... }
            rest_pseudo = ''.join(p for p in pseudo_chain if p != 'GROUPHOVER')
            selector = f'.group:hover {selector}{rest_pseudo}'
        else:
            selector += ''.join(pseudo_chain)

        body_lines = []
        for prop, val in decls:
            if prop == '__child_combinator__':
                # val already contains "> :not([hidden]) ... { ... }"
                by_media.setdefault(media, []).append(f'{selector} {val}')
                continue
            if prop.startswith('__pseudo_element__'):
                pe = prop.split('__pseudo_element__', 1)[1]
                by_media.setdefault(media, []).append(f'{selector}{pe} {val}')
                continue
            body_lines.append(f'  {prop}: {val};')
        if body_lines:
            block = selector + ' {\n' + '\n'.join(body_lines) + '\n}'
            by_media.setdefault(media, []).append(block)

    if None in by_media:
        out.append('\n'.join(by_media[None]))
        out.append('\n')
    for bp in sorted(k for k in by_media if k is not None):
        out.append(f'\n@media (min-width: {bp}px) {{\n')
        out.append('\n'.join(by_media[bp]))
        out.append('\n}\n')

    css_text = ''.join(out)
    with open(os.path.join(repo_root, 'tailwind-build.css'), 'w', encoding='utf-8') as f:
        f.write(css_text)

    print('Unresolved classes:', len(unresolved))
    for u in unresolved:
        print(' -', u)
    print('Output bytes:', len(css_text))

if __name__ == '__main__':
    render()
