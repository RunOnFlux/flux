(window["webpackJsonp"]=window["webpackJsonp"]||[]).push([["chunk-c02a7a16"],{"03da":function(t,e,n){"use strict";n.r(e);var r=function(){var t=this,e=t.$createElement,n=t._self._c||e;return n("b-overlay",{attrs:{show:t.fluxListLoading,variant:"transparent",blur:"5px"}},[n("b-card",[n("b-row",[n("b-col",{staticClass:"my-1",attrs:{md:"4",sm:"4"}},[n("b-form-group",{staticClass:"mb-0"},[n("label",{staticClass:"d-inline-block text-left mr-50"},[t._v("Per page")]),n("b-form-select",{staticClass:"w-50",attrs:{id:"perPageSelect",size:"sm",options:t.pageOptions},model:{value:t.perPage,callback:function(e){t.perPage=e},expression:"perPage"}})],1)],1),n("b-col",{staticClass:"my-1",attrs:{md:"8"}},[n("b-form-group",{staticClass:"mb-0",attrs:{label:"Filter","label-cols-sm":"1","label-align-sm":"right","label-for":"filterInput"}},[n("b-input-group",{attrs:{size:"sm"}},[n("b-form-input",{attrs:{id:"filterInput",type:"search",placeholder:"Type to Search"},model:{value:t.filter,callback:function(e){t.filter=e},expression:"filter"}}),n("b-input-group-append",[n("b-button",{attrs:{disabled:!t.filter},on:{click:function(e){t.filter=""}}},[t._v(" Clear ")])],1)],1)],1)],1),n("b-col",{attrs:{cols:"12"}},[n("b-table",{attrs:{striped:"",hover:"",responsive:"","per-page":t.perPage,"current-page":t.currentPage,items:t.items,fields:t.fields,"sort-by":t.sortBy,"sort-desc":t.sortDesc,"sort-direction":t.sortDirection,filter:t.filter,"filter-included-fields":t.filterOn},on:{"update:sortBy":function(e){t.sortBy=e},"update:sort-by":function(e){t.sortBy=e},"update:sortDesc":function(e){t.sortDesc=e},"update:sort-desc":function(e){t.sortDesc=e},filtered:t.onFiltered},scopedSlots:t._u([{key:"cell(lastpaid)",fn:function(e){return[t._v(" "+t._s(new Date(1e3*Number(e.item.lastpaid)).toLocaleString("en-GB",t.timeoptions))+" ")]}}])})],1),n("b-col",{attrs:{cols:"12"}},[n("b-pagination",{staticClass:"my-0",attrs:{"total-rows":t.totalRows,"per-page":t.perPage,align:"center",size:"sm"},model:{value:t.currentPage,callback:function(e){t.currentPage=e},expression:"currentPage"}})],1)],1)],1)],1)},i=[],a=n("c7eb"),o=n("1da1"),c=(n("d81d"),n("4de4"),n("d3b7"),n("159b"),n("7db0"),n("14d9"),n("205f")),s=n("29a1"),u=n("a15b"),l=n("b28b"),f=n("26d2"),d=n("8226"),p=n("8361"),b=n("5e12"),h=n("4797"),m=n("ccc0"),g=n("1947"),v=n("9b03"),O=n("1d17"),y=n("bc3a"),j={components:{BCard:c["a"],BTable:s["a"],BRow:u["a"],BCol:l["a"],BPagination:f["a"],BFormGroup:d["a"],BFormSelect:p["a"],BInputGroup:b["a"],BFormInput:h["a"],BInputGroupAppend:m["a"],BButton:g["a"],BOverlay:v["a"]},data:function(){return{timeoptions:{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"},fluxListLoading:!0,perPage:10,pageOptions:[10,25,50,100,1e3],sortBy:"",sortDesc:!1,sortDirection:"asc",items:[],filter:"",filterOn:[],fields:[{key:"ip",label:"IP Address",sortable:!0},{key:"payment_address",label:"Address",sortable:!0},{key:"location.country",label:"Country",sortable:!0,formatter:this.formatTableEntry},{key:"location.org",label:"Provider",sortable:!0,formatter:this.formatTableEntry},{key:"lastpaid",label:"Last Paid",sortable:!0},{key:"tier",label:"Tier",sortable:!0}],totalRows:1,currentPage:1}},computed:{sortOptions:function(){return this.fields.filter((function(t){return t.sortable})).map((function(t){return{text:t.label,value:t.key}}))}},mounted:function(){this.getFluxList()},methods:{formatTableEntry:function(t){return t||"Unknown"},getFluxList:function(){var t=this;return Object(o["a"])(Object(a["a"])().mark((function e(){var n,r,i,o,c;return Object(a["a"])().wrap((function(e){while(1)switch(e.prev=e.next){case 0:return e.prev=0,t.fluxListLoading=!0,e.next=4,y.get("https://stats.runonflux.io/fluxlocations");case 4:return n=e.sent,r=n.data.data,e.next=8,O["a"].listZelNodes();case 8:i=e.sent,o=i.data.data,c=[],o.forEach((function(t){var e=t;e.location=r.find((function(t){return t.ip===e.ip.split(":")[0]})),c.push(e)})),t.items=c.filter((function(t){return t.ip})),t.totalRows=t.items.length,t.currentPage=1,t.fluxListLoading=!1,console.log(t.items),e.next=22;break;case 19:e.prev=19,e.t0=e["catch"](0),console.log(e.t0);case 22:case"end":return e.stop()}}),e,null,[[0,19]])})))()},onFiltered:function(t){this.totalRows=t.length,this.currentPage=1}}},V=j,w=n("2877"),P=Object(w["a"])(V,r,i,!1,null,null,null);e["default"]=P.exports},"06d9":function(t,e,n){"use strict";n.d(e,"a",(function(){return i}));var r=n("2f79"),i=Object(r["c"])({computed:{selectionStart:{cache:!1,get:function(){return this.$refs.input.selectionStart},set:function(t){this.$refs.input.selectionStart=t}},selectionEnd:{cache:!1,get:function(){return this.$refs.input.selectionEnd},set:function(t){this.$refs.input.selectionEnd=t}},selectionDirection:{cache:!1,get:function(){return this.$refs.input.selectionDirection},set:function(t){this.$refs.input.selectionDirection=t}}},methods:{select:function(){var t;(t=this.$refs.input).select.apply(t,arguments)},setSelectionRange:function(){var t;(t=this.$refs.input).setSelectionRange.apply(t,arguments)},setRangeText:function(){var t;(t=this.$refs.input).setRangeText.apply(t,arguments)}}})},"1d17":function(t,e,n){"use strict";var r=n("b4c0");e["a"]={listZelNodes:function(){return Object(r["a"])().get("/daemon/listzelnodes")},zelnodeCount:function(){return Object(r["a"])().get("/daemon/getzelnodecount")}}},"1f1e":function(t,e,n){"use strict";n.d(e,"a",(function(){return i}));var r=n("2f79"),i=Object(r["c"])({computed:{validity:{cache:!1,get:function(){return this.$refs.input.validity}},validationMessage:{cache:!1,get:function(){return this.$refs.input.validationMessage}},willValidate:{cache:!1,get:function(){return this.$refs.input.willValidate}}},methods:{setCustomValidity:function(){var t;return(t=this.$refs.input).setCustomValidity.apply(t,arguments)},checkValidity:function(){var t;return(t=this.$refs.input).checkValidity.apply(t,arguments)},reportValidity:function(){var t;return(t=this.$refs.input).reportValidity.apply(t,arguments)}}})},"40fc":function(t,e,n){"use strict";n.d(e,"b",(function(){return V})),n.d(e,"a",(function(){return w}));var r=n("2f79"),i=n("0056"),a=n("a723"),o=n("906c"),c=n("6b77"),s=n("a8c8"),u=n("58f2"),l=n("3a58"),f=n("d82f"),d=n("cf75"),p=n("fa73");function b(t,e){var n=Object.keys(t);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(t);e&&(r=r.filter((function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable}))),n.push.apply(n,r)}return n}function h(t){for(var e=1;e<arguments.length;e++){var n=null!=arguments[e]?arguments[e]:{};e%2?b(Object(n),!0).forEach((function(e){m(t,e,n[e])})):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(n)):b(Object(n)).forEach((function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(n,e))}))}return t}function m(t,e,n){return e in t?Object.defineProperty(t,e,{value:n,enumerable:!0,configurable:!0,writable:!0}):t[e]=n,t}var g=Object(u["a"])("value",{type:a["o"],defaultValue:"",event:i["R"]}),v=g.mixin,O=g.props,y=g.prop,j=g.event,V=Object(d["d"])(Object(f["m"])(h(h({},O),{},{ariaInvalid:Object(d["c"])(a["j"],!1),autocomplete:Object(d["c"])(a["t"]),debounce:Object(d["c"])(a["o"],0),formatter:Object(d["c"])(a["k"]),lazy:Object(d["c"])(a["g"],!1),lazyFormatter:Object(d["c"])(a["g"],!1),number:Object(d["c"])(a["g"],!1),placeholder:Object(d["c"])(a["t"]),plaintext:Object(d["c"])(a["g"],!1),readonly:Object(d["c"])(a["g"],!1),trim:Object(d["c"])(a["g"],!1)})),"formTextControls"),w=Object(r["c"])({mixins:[v],props:V,data:function(){var t=this[y];return{localValue:Object(p["g"])(t),vModelValue:this.modifyValue(t)}},computed:{computedClass:function(){var t=this.plaintext,e=this.type,n="range"===e,r="color"===e;return[{"custom-range":n,"form-control-plaintext":t&&!n&&!r,"form-control":r||!t&&!n},this.sizeFormClass,this.stateClass]},computedDebounce:function(){return Object(s["c"])(Object(l["c"])(this.debounce,0),0)},hasFormatter:function(){return Object(d["b"])(this.formatter)}},watch:m({},y,(function(t){var e=Object(p["g"])(t),n=this.modifyValue(t);e===this.localValue&&n===this.vModelValue||(this.clearDebounce(),this.localValue=e,this.vModelValue=n)})),created:function(){this.$_inputDebounceTimer=null},beforeDestroy:function(){this.clearDebounce()},methods:{clearDebounce:function(){clearTimeout(this.$_inputDebounceTimer),this.$_inputDebounceTimer=null},formatValue:function(t,e){var n=arguments.length>2&&void 0!==arguments[2]&&arguments[2];return t=Object(p["g"])(t),!this.hasFormatter||this.lazyFormatter&&!n||(t=this.formatter(t,e)),t},modifyValue:function(t){return t=Object(p["g"])(t),this.trim&&(t=t.trim()),this.number&&(t=Object(l["b"])(t,t)),t},updateValue:function(t){var e=this,n=arguments.length>1&&void 0!==arguments[1]&&arguments[1],r=this.lazy;if(!r||n){this.clearDebounce();var i=function(){if(t=e.modifyValue(t),t!==e.vModelValue)e.vModelValue=t,e.$emit(j,t);else if(e.hasFormatter){var n=e.$refs.input;n&&t!==n.value&&(n.value=t)}},a=this.computedDebounce;a>0&&!r&&!n?this.$_inputDebounceTimer=setTimeout(i,a):i()}},onInput:function(t){if(!t.target.composing){var e=t.target.value,n=this.formatValue(e,t);!1===n||t.defaultPrevented?Object(c["f"])(t,{propagation:!1}):(this.localValue=n,this.updateValue(n),this.$emit(i["v"],n))}},onChange:function(t){var e=t.target.value,n=this.formatValue(e,t);!1===n||t.defaultPrevented?Object(c["f"])(t,{propagation:!1}):(this.localValue=n,this.updateValue(n,!0),this.$emit(i["d"],n))},onBlur:function(t){var e=t.target.value,n=this.formatValue(e,t,!0);!1!==n&&(this.localValue=Object(p["g"])(this.modifyValue(n)),this.updateValue(n,!0)),this.$emit(i["b"],t)},focus:function(){this.disabled||Object(o["d"])(this.$el)},blur:function(){this.disabled||Object(o["c"])(this.$el)}}})},"7db0":function(t,e,n){"use strict";var r=n("23e7"),i=n("b727").find,a=n("44d2"),o="find",c=!0;o in[]&&Array(1)[o]((function(){c=!1})),r({target:"Array",proto:!0,forced:c},{find:function(t){return i(this,t,arguments.length>1?arguments[1]:void 0)}}),a(o)},ad47:function(t,e,n){"use strict";n.d(e,"b",(function(){return o})),n.d(e,"a",(function(){return c}));var r=n("2f79"),i=n("a723"),a=n("cf75"),o=Object(a["d"])({size:Object(a["c"])(i["t"])},"formControls"),c=Object(r["c"])({props:o,computed:{sizeFormClass:function(){return[this.size?"form-control-".concat(this.size):null]}}})},d520:function(t,e,n){"use strict";n.d(e,"b",(function(){return s})),n.d(e,"a",(function(){return u}));var r=n("2f79"),i=n("a723"),a=n("7b1e"),o=n("cf75"),c=n("440b"),s=Object(o["d"])({state:Object(o["c"])(i["g"],null)},"formState"),u=Object(r["c"])({props:s,computed:{computedState:function(){return Object(a["b"])(this.state)?this.state:null},stateClass:function(){var t=this.computedState;return!0===t?"is-valid":!1===t?"is-invalid":null},computedAriaInvalid:function(){var t=Object(c["a"])(this).ariaInvalid;return!0===t||"true"===t||""===t||!1===this.computedState?"true":t}}})},dde7:function(t,e,n){"use strict";n.d(e,"b",(function(){return s})),n.d(e,"a",(function(){return u}));var r=n("2f79"),i=n("a723"),a=n("906c"),o=n("cf75"),c="input, textarea, select",s=Object(o["d"])({autofocus:Object(o["c"])(i["g"],!1),disabled:Object(o["c"])(i["g"],!1),form:Object(o["c"])(i["t"]),id:Object(o["c"])(i["t"]),name:Object(o["c"])(i["t"]),required:Object(o["c"])(i["g"],!1)},"formControls"),u=Object(r["c"])({props:s,mounted:function(){this.handleAutofocus()},activated:function(){this.handleAutofocus()},methods:{handleAutofocus:function(){var t=this;this.$nextTick((function(){Object(a["B"])((function(){var e=t.$el;t.autofocus&&Object(a["u"])(e)&&(Object(a["v"])(e,c)||(e=Object(a["C"])(c,e)),Object(a["d"])(e))}))}))}}})},f07e:function(t,e,n){"use strict";n.d(e,"a",(function(){return r}));var r=function(){}}}]);