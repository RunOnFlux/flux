<script>
import { Line, mixins } from 'vue-chartjs'

const { reactiveProp } = mixins

export default {
  extends: Line,
  mixins: [reactiveProp],
  props: {
    options: {
      type: Object,
      default: null,
    },
    plugins: {
      type: Array,
      default: null,
    },
    styles: {
      type: Object,
      default: null,
    },
  },
  mounted() {
    this.renderChart(this.chartData, this.options, this.plugins, this.styles)
  },
}
</script>
