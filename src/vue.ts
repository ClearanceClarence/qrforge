import { computed, defineComponent, h, type PropType } from 'vue'
import { svgParts } from './render/svg'
import type { RenderOptions } from './render/style'

/** Renders a QR code as an inline SVG element. Styling goes in the `options` prop. */
export const QRCode = defineComponent({
  name: 'QRCode',
  props: {
    value: { type: [String, Object] as PropType<string | Uint8Array>, required: true },
    options: { type: Object as PropType<RenderOptions>, default: () => ({}) },
    size: { type: Number, default: undefined },
    title: { type: String, default: undefined },
  },
  setup(props) {
    const parts = computed(() => svgParts(props.value, { ...props.options, title: props.title }))
    return () =>
      h('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: `0 0 ${parts.value.viewSize} ${parts.value.viewSize}`,
        width: props.size,
        height: props.size,
        role: 'img',
        'aria-label': props.title,
        'shape-rendering': parts.value.crisp ? 'crispEdges' : undefined,
        innerHTML: parts.value.body,
      })
  },
})

export default QRCode
