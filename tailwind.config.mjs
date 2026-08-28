export default {
  content: ['./src/renderer/**/*.{html,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0d1117',
        column: '#161b22',
        card: '#1c2128',
        line: '#30363d',
        'line-hover': '#484f58',
        fg: '#e6edf3',
        'fg-dim': '#8b949e',
        running: '#3fb950',
        idle: '#d29922',
        stopped: '#6e7681',
        danger: '#f85149',
      },
      fontFamily: {
        ui: ['-apple-system', 'SF Pro Text', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'monospace'],
      },
      transitionDuration: { DEFAULT: '150ms' },
    },
  },
}
