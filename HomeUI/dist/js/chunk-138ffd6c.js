(window["webpackJsonp"]=window["webpackJsonp"]||[]).push([["chunk-138ffd6c"],{"01e3":function(t,e,r){"use strict";r.d(e,"a",(function(){return f}));var a=r("2f79"),n=r("b42e"),s=r("c637"),c=r("a723"),i=r("9b76"),o=r("365c"),l=r("cf75");function u(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}var b=Object(l["d"])({label:Object(l["c"])(c["t"]),role:Object(l["c"])(c["t"],"status"),small:Object(l["c"])(c["g"],!1),tag:Object(l["c"])(c["t"],"span"),type:Object(l["c"])(c["t"],"border"),variant:Object(l["c"])(c["t"])},s["pb"]),f=Object(a["c"])({name:s["pb"],functional:!0,props:b,render:function(t,e){var r,a=e.props,s=e.data,c=e.slots,l=e.scopedSlots,b=c(),f=l||{},d=Object(o["b"])(i["s"],{},f,b)||a.label;return d&&(d=t("span",{staticClass:"sr-only"},d)),t(a.tag,Object(n["a"])(s,{attrs:{role:d?a.role||"status":null,"aria-hidden":d?null:"true"},class:(r={},u(r,"spinner-".concat(a.type),a.type),u(r,"spinner-".concat(a.type,"-sm"),a.small),u(r,"text-".concat(a.variant),a.variant),r)}),[d||t()])}})},"0753":function(t,e,r){"use strict";r.r(e),r.d(e,"attach",(function(){return s})),r.d(e,"detach",(function(){return c})),r.d(e,"shouldRetryRequest",(function(){return u})),r.d(e,"getConfig",(function(){return b}));var a=r("bc3a"),n=r.n(a);function s(t){return(t=t||n.a).interceptors.response.use(i,l)}function c(t,e){(e=e||n.a).interceptors.response.eject(t)}function i(t){return t}function o(t){var e=[];if(t)return Array.isArray(t)?t:("object"==typeof t&&Object.keys(t).forEach((function(r){"number"==typeof r&&(e[r]=t[r])})),e)}function l(t){if(n.a.isCancel(t))return Promise.reject(t);var e=b(t)||{};if(e.currentRetryAttempt=e.currentRetryAttempt||0,e.retry="number"==typeof e.retry?e.retry:3,e.retryDelay="number"==typeof e.retryDelay?e.retryDelay:100,e.instance=e.instance||n.a,e.backoffType=e.backoffType||"exponential",e.httpMethodsToRetry=o(e.httpMethodsToRetry)||["GET","HEAD","PUT","OPTIONS","DELETE"],e.noResponseRetries="number"==typeof e.noResponseRetries?e.noResponseRetries:2,e.checkRetryAfter="boolean"!=typeof e.checkRetryAfter||e.checkRetryAfter,e.maxRetryAfter="number"==typeof e.maxRetryAfter?e.maxRetryAfter:3e5,e.statusCodesToRetry=o(e.statusCodesToRetry)||[[100,199],[429,429],[500,599]],t.config=t.config||{},t.config.raxConfig=Object.assign({},e),!(e.shouldRetry||u)(t))return Promise.reject(t);var r=new Promise((function(r,a){var n=0;if(e.checkRetryAfter&&t.response&&t.response.headers["retry-after"]){var s=function(t){var e=Number(t);if(!Number.isNaN(e))return 1e3*e;var r=Date.parse(t);return Number.isNaN(r)?void 0:r-Date.now()}(t.response.headers["retry-after"]);if(!(s&&s>0&&s<=e.maxRetryAfter))return a(t);n=s}t.config.raxConfig.currentRetryAttempt+=1;var c=t.config.raxConfig.currentRetryAttempt;0===n&&(n="linear"===e.backoffType?1e3*c:"static"===e.backoffType?e.retryDelay:(Math.pow(2,c)-1)/2*1e3,"number"==typeof e.maxRetryDelay&&(n=Math.min(n,e.maxRetryDelay))),setTimeout(r,n)})),a=e.onRetryAttempt?Promise.resolve(e.onRetryAttempt(t)):Promise.resolve();return Promise.resolve().then((function(){return r})).then((function(){return a})).then((function(){return e.instance.request(t.config)}))}function u(t){var e=t.config.raxConfig;if(!e||0===e.retry)return!1;if(!t.response&&(e.currentRetryAttempt||0)>=e.noResponseRetries)return!1;if(!t.config.method||e.httpMethodsToRetry.indexOf(t.config.method.toUpperCase())<0)return!1;if(t.response&&t.response.status){for(var r=!1,a=0,n=e.statusCodesToRetry;a<n.length;a+=1){var s=n[a],c=t.response.status;if(c>=s[0]&&c<=s[1]){r=!0;break}}if(!r)return!1}return e.currentRetryAttempt=e.currentRetryAttempt||0,!(e.currentRetryAttempt>=e.retry)}function b(t){if(t&&t.config)return t.config.raxConfig}},"1d17":function(t,e,r){"use strict";var a=r("b4c0");e["a"]={listZelNodes:function(){return Object(a["a"])().get("/daemon/listzelnodes")},zelnodeCount:function(){return Object(a["a"])().get("/daemon/getzelnodecount")},blockReward:function(){return Object(a["a"])().get("/daemon/getblocksubsidy")}}},"205f":function(t,e,r){"use strict";r.d(e,"a",(function(){return A}));var a=r("2f79"),n=r("b42e"),s=r("c637"),c=r("a723"),i=r("9b76"),o=r("8690"),l=r("365c"),u=r("d82f"),b=r("cf75"),f=r("d580"),d=r("6197"),p=r("b885");function m(t,e){var r=Object.keys(t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(t);e&&(a=a.filter((function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable}))),r.push.apply(r,a)}return r}function O(t){for(var e=1;e<arguments.length;e++){var r=null!=arguments[e]?arguments[e]:{};e%2?m(Object(r),!0).forEach((function(e){h(t,e,r[e])})):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(r)):m(Object(r)).forEach((function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(r,e))}))}return t}function h(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}var g=Object(b["d"])(Object(u["m"])(O(O({},Object(b["a"])(f["a"],b["f"].bind(null,"footer"))),{},{footer:Object(b["c"])(c["t"]),footerClass:Object(b["c"])(c["e"]),footerHtml:Object(b["c"])(c["t"])})),s["l"]),j=Object(a["c"])({name:s["l"],functional:!0,props:g,render:function(t,e){var r,a=e.props,s=e.data,c=e.children,i=a.footerBgVariant,l=a.footerBorderVariant,u=a.footerTextVariant;return t(a.footerTag,Object(n["a"])(s,{staticClass:"card-footer",class:[a.footerClass,(r={},h(r,"bg-".concat(i),i),h(r,"border-".concat(l),l),h(r,"text-".concat(u),u),r)],domProps:c?{}:Object(o["a"])(a.footerHtml,a.footer)}),c)}}),v=r("4918");function y(t,e){var r=Object.keys(t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(t);e&&(a=a.filter((function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable}))),r.push.apply(r,a)}return r}function w(t){for(var e=1;e<arguments.length;e++){var r=null!=arguments[e]?arguments[e]:{};e%2?y(Object(r),!0).forEach((function(e){x(t,e,r[e])})):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(r)):y(Object(r)).forEach((function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(r,e))}))}return t}function x(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}var C=Object(b["d"])(Object(u["m"])(w(w({},Object(u["k"])(v["b"],["src","alt","width","height","left","right"])),{},{bottom:Object(b["c"])(c["g"],!1),end:Object(b["c"])(c["g"],!1),start:Object(b["c"])(c["g"],!1),top:Object(b["c"])(c["g"],!1)})),s["n"]),P=Object(a["c"])({name:s["n"],functional:!0,props:C,render:function(t,e){var r=e.props,a=e.data,s=r.src,c=r.alt,i=r.width,o=r.height,l="card-img";return r.top?l+="-top":r.right||r.end?l+="-right":r.bottom?l+="-bottom":(r.left||r.start)&&(l+="-left"),t("img",Object(n["a"])(a,{class:l,attrs:{src:s,alt:c,width:i,height:o}}))}});function k(t,e){var r=Object.keys(t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(t);e&&(a=a.filter((function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable}))),r.push.apply(r,a)}return r}function _(t){for(var e=1;e<arguments.length;e++){var r=null!=arguments[e]?arguments[e]:{};e%2?k(Object(r),!0).forEach((function(e){R(t,e,r[e])})):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(r)):k(Object(r)).forEach((function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(r,e))}))}return t}function R(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}var T=Object(b["a"])(C,b["f"].bind(null,"img"));T.imgSrc.required=!1;var D=Object(b["d"])(Object(u["m"])(_(_(_(_(_(_({},d["b"]),p["b"]),g),T),f["a"]),{},{align:Object(b["c"])(c["t"]),noBody:Object(b["c"])(c["g"],!1)})),s["j"]),A=Object(a["c"])({name:s["j"],functional:!0,props:D,render:function(t,e){var r,a=e.props,s=e.data,c=e.slots,u=e.scopedSlots,f=a.imgSrc,m=a.imgLeft,O=a.imgRight,h=a.imgStart,v=a.imgEnd,y=a.imgBottom,w=a.header,x=a.headerHtml,C=a.footer,k=a.footerHtml,_=a.align,D=a.textVariant,A=a.bgVariant,S=a.borderVariant,V=u||{},F=c(),U={},W=t(),L=t();if(f){var E=t(P,{props:Object(b["e"])(T,a,b["h"].bind(null,"img"))});y?L=E:W=E}var X=t(),B=Object(l["a"])(i["p"],V,F);(B||w||x)&&(X=t(p["a"],{props:Object(b["e"])(p["b"],a),domProps:B?{}:Object(o["a"])(x,w)},Object(l["b"])(i["p"],U,V,F)));var I=Object(l["b"])(i["h"],U,V,F);a.noBody||(I=t(d["a"],{props:Object(b["e"])(d["b"],a)},I),a.overlay&&f&&(I=t("div",{staticClass:"position-relative"},[W,I,L]),W=t(),L=t()));var z=t(),M=Object(l["a"])(i["o"],V,F);return(M||C||k)&&(z=t(j,{props:Object(b["e"])(g,a),domProps:B?{}:Object(o["a"])(k,C)},Object(l["b"])(i["o"],U,V,F))),t(a.tag,Object(n["a"])(s,{staticClass:"card",class:(r={"flex-row":m||h,"flex-row-reverse":(O||v)&&!(m||h)},R(r,"text-".concat(_),_),R(r,"bg-".concat(A),A),R(r,"border-".concat(S),S),R(r,"text-".concat(D),D),r)}),[W,X,I,z,L])}})},4918:function(t,e,r){"use strict";r.d(e,"b",(function(){return O})),r.d(e,"a",(function(){return h}));var a=r("2f79"),n=r("b42e"),s=r("c637"),c=r("a723"),i=r("2326"),o=r("6c06"),l=r("7b1e"),u=r("3a58"),b=r("cf75"),f=r("fa73");function d(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}var p='<svg width="%{w}" height="%{h}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %{w} %{h}" preserveAspectRatio="none"><rect width="100%" height="100%" style="fill:%{f};"></rect></svg>',m=function(t,e,r){var a=encodeURIComponent(p.replace("%{w}",Object(f["g"])(t)).replace("%{h}",Object(f["g"])(e)).replace("%{f}",r));return"data:image/svg+xml;charset=UTF-8,".concat(a)},O=Object(b["d"])({alt:Object(b["c"])(c["t"]),blank:Object(b["c"])(c["g"],!1),blankColor:Object(b["c"])(c["t"],"transparent"),block:Object(b["c"])(c["g"],!1),center:Object(b["c"])(c["g"],!1),fluid:Object(b["c"])(c["g"],!1),fluidGrow:Object(b["c"])(c["g"],!1),height:Object(b["c"])(c["o"]),left:Object(b["c"])(c["g"],!1),right:Object(b["c"])(c["g"],!1),rounded:Object(b["c"])(c["j"],!1),sizes:Object(b["c"])(c["f"]),src:Object(b["c"])(c["t"]),srcset:Object(b["c"])(c["f"]),thumbnail:Object(b["c"])(c["g"],!1),width:Object(b["c"])(c["o"])},s["O"]),h=Object(a["c"])({name:s["O"],functional:!0,props:O,render:function(t,e){var r,a=e.props,s=e.data,c=a.alt,b=a.src,p=a.block,O=a.fluidGrow,h=a.rounded,g=Object(u["c"])(a.width)||null,j=Object(u["c"])(a.height)||null,v=null,y=Object(i["b"])(a.srcset).filter(o["a"]).join(","),w=Object(i["b"])(a.sizes).filter(o["a"]).join(",");return a.blank&&(!j&&g?j=g:!g&&j&&(g=j),g||j||(g=1,j=1),b=m(g,j,a.blankColor||"transparent"),y=null,w=null),a.left?v="float-left":a.right?v="float-right":a.center&&(v="mx-auto",p=!0),t("img",Object(n["a"])(s,{attrs:{src:b,alt:c,width:g?Object(f["g"])(g):null,height:j?Object(f["g"])(j):null,srcset:y||null,sizes:w||null},class:(r={"img-thumbnail":a.thumbnail,"img-fluid":a.fluid||O,"w-100":O,rounded:""===h||!0===h},d(r,"rounded-".concat(h),Object(l["m"])(h)&&""!==h),d(r,v,v),d(r,"d-block",p),r)}))}})},4968:function(t,e,r){"use strict";r.d(e,"b",(function(){return l})),r.d(e,"a",(function(){return u}));var a=r("2f79"),n=r("b42e"),s=r("c637"),c=r("a723"),i=r("cf75"),o=r("fa73"),l=Object(i["d"])({title:Object(i["c"])(c["t"]),titleTag:Object(i["c"])(c["t"],"h4")},s["q"]),u=Object(a["c"])({name:s["q"],functional:!0,props:l,render:function(t,e){var r=e.props,a=e.data,s=e.children;return t(r.titleTag,Object(n["a"])(a,{staticClass:"card-title"}),s||Object(o["g"])(r.title))}})},"595a":function(t,e,r){"use strict";r("e1fe")},6197:function(t,e,r){"use strict";r.d(e,"b",(function(){return m})),r.d(e,"a",(function(){return O}));var a=r("2f79"),n=r("b42e"),s=r("c637"),c=r("a723"),i=r("d82f"),o=r("cf75"),l=r("d580"),u=r("4968"),b=r("ba06");function f(t,e){var r=Object.keys(t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(t);e&&(a=a.filter((function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable}))),r.push.apply(r,a)}return r}function d(t){for(var e=1;e<arguments.length;e++){var r=null!=arguments[e]?arguments[e]:{};e%2?f(Object(r),!0).forEach((function(e){p(t,e,r[e])})):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(r)):f(Object(r)).forEach((function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(r,e))}))}return t}function p(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}var m=Object(o["d"])(Object(i["m"])(d(d(d(d({},u["b"]),b["b"]),Object(o["a"])(l["a"],o["f"].bind(null,"body"))),{},{bodyClass:Object(o["c"])(c["e"]),overlay:Object(o["c"])(c["g"],!1)})),s["k"]),O=Object(a["c"])({name:s["k"],functional:!0,props:m,render:function(t,e){var r,a=e.props,s=e.data,c=e.children,i=a.bodyBgVariant,l=a.bodyBorderVariant,f=a.bodyTextVariant,d=t();a.title&&(d=t(u["a"],{props:Object(o["e"])(u["b"],a)}));var m=t();return a.subTitle&&(m=t(b["a"],{props:Object(o["e"])(b["b"],a),class:["mb-2"]})),t(a.bodyTag,Object(n["a"])(s,{staticClass:"card-body",class:[(r={"card-img-overlay":a.overlay},p(r,"bg-".concat(i),i),p(r,"border-".concat(l),l),p(r,"text-".concat(f),f),r),a.bodyClass]}),[d,m,c])}})},"676d":function(t,e,r){},"7db0":function(t,e,r){"use strict";var a=r("23e7"),n=r("b727").find,s=r("44d2"),c="find",i=!0;c in[]&&Array(1)[c]((function(){i=!1})),a({target:"Array",proto:!0,forced:i},{find:function(t){return n(this,t,arguments.length>1?arguments[1]:void 0)}}),s(c)},"9b03":function(t,e,r){"use strict";r.d(e,"a",(function(){return g}));var a=r("2f79"),n=r("c637"),s=r("0056"),c=r("a723"),i=r("9b76"),o=r("3a58"),l=r("8c18"),u=r("cf75"),b=r("01e3"),f=r("ce2a");function d(t,e){var r=Object.keys(t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(t);e&&(a=a.filter((function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable}))),r.push.apply(r,a)}return r}function p(t){for(var e=1;e<arguments.length;e++){var r=null!=arguments[e]?arguments[e]:{};e%2?d(Object(r),!0).forEach((function(e){m(t,e,r[e])})):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(r)):d(Object(r)).forEach((function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(r,e))}))}return t}function m(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}var O={top:0,left:0,bottom:0,right:0},h=Object(u["d"])({bgColor:Object(u["c"])(c["t"]),blur:Object(u["c"])(c["t"],"2px"),fixed:Object(u["c"])(c["g"],!1),noCenter:Object(u["c"])(c["g"],!1),noFade:Object(u["c"])(c["g"],!1),noWrap:Object(u["c"])(c["g"],!1),opacity:Object(u["c"])(c["o"],.85,(function(t){var e=Object(o["b"])(t,0);return e>=0&&e<=1})),overlayTag:Object(u["c"])(c["t"],"div"),rounded:Object(u["c"])(c["j"],!1),show:Object(u["c"])(c["g"],!1),spinnerSmall:Object(u["c"])(c["g"],!1),spinnerType:Object(u["c"])(c["t"],"border"),spinnerVariant:Object(u["c"])(c["t"]),variant:Object(u["c"])(c["t"],"light"),wrapTag:Object(u["c"])(c["t"],"div"),zIndex:Object(u["c"])(c["o"],10)},n["gb"]),g=Object(a["c"])({name:n["gb"],mixins:[l["a"]],props:h,computed:{computedRounded:function(){var t=this.rounded;return!0===t||""===t?"rounded":t?"rounded-".concat(t):""},computedVariant:function(){var t=this.variant;return t&&!this.bgColor?"bg-".concat(t):""},slotScope:function(){return{spinnerType:this.spinnerType||null,spinnerVariant:this.spinnerVariant||null,spinnerSmall:this.spinnerSmall}}},methods:{defaultOverlayFn:function(t){var e=t.spinnerType,r=t.spinnerVariant,a=t.spinnerSmall;return this.$createElement(b["a"],{props:{type:e,variant:r,small:a}})}},render:function(t){var e=this,r=this.show,a=this.fixed,n=this.noFade,c=this.noWrap,o=this.slotScope,l=t();if(r){var u=t("div",{staticClass:"position-absolute",class:[this.computedVariant,this.computedRounded],style:p(p({},O),{},{opacity:this.opacity,backgroundColor:this.bgColor||null,backdropFilter:this.blur?"blur(".concat(this.blur,")"):null})}),b=t("div",{staticClass:"position-absolute",style:this.noCenter?p({},O):{top:"50%",left:"50%",transform:"translateX(-50%) translateY(-50%)"}},[this.normalizeSlot(i["C"],o)||this.defaultOverlayFn(o)]);l=t(this.overlayTag,{staticClass:"b-overlay",class:{"position-absolute":!c||c&&!a,"position-fixed":c&&a},style:p(p({},O),{},{zIndex:this.zIndex||10}),on:{click:function(t){return e.$emit(s["f"],t)}},key:"overlay"},[u,b])}return l=t(f["a"],{props:{noFade:n,appear:!0},on:{"after-enter":function(){return e.$emit(s["O"])},"after-leave":function(){return e.$emit(s["s"])}}},[l]),c?l:t(this.wrapTag,{staticClass:"b-overlay-wrap position-relative",attrs:{"aria-busy":r?"true":null}},c?[l]:[this.normalizeSlot(),l])}})},b4a3:function(t,e,r){"use strict";r("676d")},b885:function(t,e,r){"use strict";r.d(e,"b",(function(){return p})),r.d(e,"a",(function(){return m}));var a=r("2f79"),n=r("b42e"),s=r("c637"),c=r("a723"),i=r("8690"),o=r("d82f"),l=r("cf75"),u=r("d580");function b(t,e){var r=Object.keys(t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(t);e&&(a=a.filter((function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable}))),r.push.apply(r,a)}return r}function f(t){for(var e=1;e<arguments.length;e++){var r=null!=arguments[e]?arguments[e]:{};e%2?b(Object(r),!0).forEach((function(e){d(t,e,r[e])})):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(r)):b(Object(r)).forEach((function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(r,e))}))}return t}function d(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}var p=Object(l["d"])(Object(o["m"])(f(f({},Object(l["a"])(u["a"],l["f"].bind(null,"header"))),{},{header:Object(l["c"])(c["t"]),headerClass:Object(l["c"])(c["e"]),headerHtml:Object(l["c"])(c["t"])})),s["m"]),m=Object(a["c"])({name:s["m"],functional:!0,props:p,render:function(t,e){var r,a=e.props,s=e.data,c=e.children,o=a.headerBgVariant,l=a.headerBorderVariant,u=a.headerTextVariant;return t(a.headerTag,Object(n["a"])(s,{staticClass:"card-header",class:[a.headerClass,(r={},d(r,"bg-".concat(o),o),d(r,"border-".concat(l),l),d(r,"text-".concat(u),u),r)],domProps:c?{}:Object(i["a"])(a.headerHtml,a.header)}),c)}})},ba06:function(t,e,r){"use strict";r.d(e,"b",(function(){return l})),r.d(e,"a",(function(){return u}));var a=r("2f79"),n=r("b42e"),s=r("c637"),c=r("a723"),i=r("cf75"),o=r("fa73"),l=Object(i["d"])({subTitle:Object(i["c"])(c["t"]),subTitleTag:Object(i["c"])(c["t"],"h6"),subTitleTextVariant:Object(i["c"])(c["t"],"muted")},s["o"]),u=Object(a["c"])({name:s["o"],functional:!0,props:l,render:function(t,e){var r=e.props,a=e.data,s=e.children;return t(r.subTitleTag,Object(n["a"])(a,{staticClass:"card-subtitle",class:[r.subTitleTextVariant?"text-".concat(r.subTitleTextVariant):null]}),s||Object(o["g"])(r.subTitle))}})},c773:function(t,e,r){"use strict";var a=r("b4c0");e["a"]={getAddressBalance:function(t){return Object(a["a"])().get("/explorer/balance/".concat(t))},getAddressTransactions:function(t){return Object(a["a"])().get("/explorer/transactions/".concat(t))},getFluxTransactions:function(t){return Object(a["a"])().get("/explorer/fluxtxs/".concat(t))},getScannedHeight:function(){return Object(a["a"])().get("/explorer/scannedheight")},reindexExplorer:function(t){return Object(a["a"])().get("/explorer/reindex/false",{headers:{zelidauth:t}})},reindexFlux:function(t){return Object(a["a"])().get("/explorer/reindex/true",{headers:{zelidauth:t}})},rescanExplorer:function(t,e){return Object(a["a"])().get("/explorer/rescan/".concat(e,"/false"),{headers:{zelidauth:t}})},rescanFlux:function(t,e){return Object(a["a"])().get("/explorer/rescan/".concat(e,"/true"),{headers:{zelidauth:t}})},restartBlockProcessing:function(t){return Object(a["a"])().get("/explorer/restart",{headers:{zelidauth:t}})},stopBlockProcessing:function(t){return Object(a["a"])().get("/explorer/stop",{headers:{zelidauth:t}})}}},d580:function(t,e,r){"use strict";r.d(e,"a",(function(){return i}));var a=r("2f79"),n=r("c637"),s=r("a723"),c=r("cf75"),i=Object(c["d"])({bgVariant:Object(c["c"])(s["t"]),borderVariant:Object(c["c"])(s["t"]),tag:Object(c["c"])(s["t"],"div"),textVariant:Object(c["c"])(s["t"])},n["j"]);Object(a["c"])({props:i})},d6e4:function(t,e,r){"use strict";r.d(e,"a",(function(){return l}));var a=r("2f79"),n=r("b42e"),s=r("c637"),c=r("a723"),i=r("cf75"),o=Object(i["d"])({textTag:Object(i["c"])(c["t"],"p")},s["p"]),l=Object(a["c"])({name:s["p"],functional:!0,props:o,render:function(t,e){var r=e.props,a=e.data,s=e.children;return t(r.textTag,Object(n["a"])(a,{staticClass:"card-text"}),s)}})},e1fe:function(t,e,r){},f03d:function(t,e,r){"use strict";r.r(e);var a=function(){var t=this,e=t.$createElement,r=t._self._c||e;return r("div",[r("b-row",{staticClass:"text-center"},[r("b-col",{attrs:{sm:"12",md:"6",lg:"4"}},[r("b-card",{attrs:{title:"Cumulus Rewards"}},[r("b-card-text",[t._v(t._s(t.cumulusCollateral.toLocaleString())+" FLUX Collateral")]),r("app-timeline",{staticClass:"mt-2"},[r("app-timeline-item",[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("div",[r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.cumulusWeek/7))+" FLUX ")]),r("small",{staticClass:"mt-0"},[t._v("+")]),r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(.1*t.cumulusWeek*t.activeParallelAssets/7))+" FLUX Tokens ")])]),r("small",{staticClass:"text-muted"},[t._v("Per Day")])])]),r("app-timeline-item",[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("div",[r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.cumulusWeek))+" FLUX ")]),r("small",{staticClass:"mt-0"},[t._v("+")]),r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(.1*t.cumulusWeek*t.activeParallelAssets))+" FLUX Tokens ")])]),r("small",{staticClass:"text-muted"},[t._v("Per Week")])])]),r("app-timeline-item",[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("div",[r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.cumulusWeek*t.weeksInAMonth))+" FLUX ")]),r("small",{staticClass:"mt-0"},[t._v("+")]),r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.cumulusWeek*t.weeksInAMonth*.1*t.activeParallelAssets))+" FLUX Tokens ")])]),r("small",{staticClass:"text-muted"},[t._v("Per Month")])])])],1)],1)],1),r("b-col",{attrs:{sm:"12",md:"6",lg:"4"}},[r("b-card",{attrs:{title:"Nimbus Rewards"}},[r("b-card-text",[t._v(t._s(t.nimbusCollateral.toLocaleString())+" FLUX Collateral")]),r("app-timeline",{staticClass:"mt-2"},[r("app-timeline-item",{attrs:{variant:"warning"}},[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("div",[r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.nimbusWeek/7))+" FLUX ")]),r("small",{staticClass:"mt-0"},[t._v("+")]),r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(.1*t.nimbusWeek*t.activeParallelAssets/7))+" FLUX Tokens ")])]),r("small",{staticClass:"text-muted"},[t._v("Per Day")])])]),r("app-timeline-item",{attrs:{variant:"warning"}},[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("div",[r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.nimbusWeek))+" FLUX ")]),r("small",{staticClass:"mt-0"},[t._v("+")]),r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(.1*t.nimbusWeek*t.activeParallelAssets))+" FLUX Tokens ")])]),r("small",{staticClass:"text-muted"},[t._v("Per Week")])])]),r("app-timeline-item",{attrs:{variant:"warning"}},[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("div",[r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.nimbusWeek*t.weeksInAMonth))+" FLUX ")]),r("small",{staticClass:"mt-0"},[t._v("+")]),r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.nimbusWeek*t.weeksInAMonth*.1*t.activeParallelAssets))+" FLUX Tokens ")])]),r("small",{staticClass:"text-muted"},[t._v("Per Month")])])])],1)],1)],1),r("b-col",{attrs:{sm:"12",md:"12",lg:"4"}},[r("b-card",{attrs:{title:"Stratus Rewards"}},[r("b-card-text",[t._v(t._s(t.stratusCollateral.toLocaleString())+" FLUX Collateral")]),r("app-timeline",{staticClass:"mt-2"},[r("app-timeline-item",{attrs:{variant:"danger"}},[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("div",[r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.stratusWeek/7))+" FLUX ")]),r("small",{staticClass:"mt-0"},[t._v("+")]),r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(.1*t.stratusWeek*t.activeParallelAssets/7))+" FLUX Tokens ")])]),r("small",{staticClass:"text-muted"},[t._v("Per Day")])])]),r("app-timeline-item",{attrs:{variant:"danger"}},[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("div",[r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.stratusWeek))+" FLUX ")]),r("small",{staticClass:"mt-0"},[t._v("+")]),r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(.1*t.stratusWeek*t.activeParallelAssets))+" FLUX Tokens ")])]),r("small",{staticClass:"text-muted"},[t._v("Per Week")])])]),r("app-timeline-item",{attrs:{variant:"danger"}},[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("div",[r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.stratusWeek*t.weeksInAMonth))+" FLUX ")]),r("small",{staticClass:"mt-0"},[t._v("+")]),r("h6",{staticClass:"mb-0"},[t._v(" "+t._s(t.beautifyValue(t.stratusWeek*t.weeksInAMonth*.1*t.activeParallelAssets))+" FLUX Tokens ")])]),r("small",{staticClass:"text-muted"},[t._v("Per Month")])])])],1)],1)],1)],1),r("b-overlay",{attrs:{show:t.loadingPrice,variant:"transparent",blur:"5px"}},[r("b-card",{attrs:{"no-body":""}},[r("b-card-body",[r("h4",[t._v(" Historical Price Chart ")])]),r("vue-apex-charts",{attrs:{type:"area",height:"250",width:"100%",options:t.lineChart.chartOptions,series:t.lineChart.series}})],1)],1)],1)},n=[],s=r("c7eb"),c=r("1da1"),i=(r("b64b"),r("4de4"),r("d3b7"),r("14d9"),r("b680"),r("7db0"),r("ac1f"),r("5319"),r("205f")),o=r("d6e4"),l=r("6197"),u=r("a15b"),b=r("b28b"),f=r("9b03"),d=function(){var t=this,e=t.$createElement,r=t._self._c||e;return r("ul",t._g(t._b({staticClass:"app-timeline"},"ul",t.$attrs,!1),t.$listeners),[t._t("default")],2)},p=[],m={},O=m,h=(r("b4a3"),r("2877")),g=Object(h["a"])(O,d,p,!1,null,"1fc4912e",null),j=g.exports,v=function(){var t=this,e=t.$createElement,r=t._self._c||e;return r("li",t._g(t._b({staticClass:"timeline-item",class:["timeline-variant-"+t.variant,t.fillBorder?"timeline-item-fill-border-"+t.variant:null]},"li",t.$attrs,!1),t.$listeners),[t.icon?r("div",{staticClass:"timeline-item-icon d-flex align-items-center justify-content-center rounded-circle"},[r("feather-icon",{attrs:{icon:t.icon}})],1):r("div",{staticClass:"timeline-item-point"}),t._t("default",(function(){return[r("div",{staticClass:"d-flex flex-sm-row flex-column flex-wrap justify-content-between mb-1 mb-sm-0"},[r("h6",{domProps:{textContent:t._s(t.title)}}),r("small",{staticClass:"timeline-item-time text-nowrap text-muted",domProps:{textContent:t._s(t.time)}})]),r("p",{staticClass:"mb-0",domProps:{textContent:t._s(t.subtitle)}})]}))],2)},y=[],w={props:{variant:{type:String,default:"primary"},title:{type:String,default:null},subtitle:{type:String,default:null},time:{type:String,default:null},icon:{type:String,default:null},fillBorder:{type:Boolean,default:!1}}},x=w,C=(r("595a"),Object(h["a"])(x,v,y,!1,null,"384df2b1",null)),P=C.exports,k=r("b307"),_=r("e009"),R=r("1321"),T=r.n(R),D=r("94c8"),A=r("1d17"),S=r("c773"),V=r("0753"),F=r("bc3a"),U={components:{BCard:i["a"],BCardText:o["a"],BCardBody:l["a"],BRow:u["a"],BCol:b["a"],BOverlay:f["a"],AppTimeline:j,AppTimelineItem:P,VueApexCharts:T.a,ToastificationContent:k["a"]},directives:{Ripple:_["a"]},data:function(){var t=this;return{interceptorID:0,cumulusHostingCost:11,nimbusHostingCost:25,stratusHostingCost:52,weeksInAMonth:4.34812141,loadingPrice:!0,historicalPrices:[],cumulusWeek:0,nimbusWeek:0,stratusWeek:0,cumulusUSDRewardWeek:0,nimbusUSDRewardWeek:0,stratusUSDRewardWeek:0,cumulusCollateral:0,nimbusCollateral:0,stratusCollateral:0,latestPrice:0,lineChart:{series:[],chartOptions:{colors:[D["b"].primary],labels:["Price"],grid:{show:!1,padding:{left:0,right:0}},chart:{toolbar:{show:!1},sparkline:{enabled:!0},stacked:!0},dataLabels:{enabled:!1},stroke:{curve:"smooth",width:2.5},fill:{type:"gradient",gradient:{shadeIntensity:.9,opacityFrom:.7,opacityTo:0}},xaxis:{type:"numeric",lines:{show:!1},axisBorder:{show:!1},labels:{show:!1}},yaxis:[{y:0,offsetX:0,offsetY:0,padding:{left:0,right:0}}],tooltip:{x:{formatter:function(e){return new Date(e).toLocaleString("en-GB",t.timeoptions)}},y:{formatter:function(e){return"$".concat(t.beautifyValue(e,2)," USD")}}}}},retryOptions:{raxConfig:{onRetryAttempt:function(t){var e=V.getConfig(t);console.log("Retry attempt #".concat(e.currentRetryAttempt))}}},activeParallelAssets:7}},mounted:function(){var t=this;this.interceptorID=V.attach(),this.getData(),setInterval((function(){t.getData()}),6e5)},unmounted:function(){V.detach(this.interceptorID)},methods:{getData:function(){var t=this;return Object(c["a"])(Object(s["a"])().mark((function e(){return Object(s["a"])().wrap((function(e){while(1)switch(e.prev=e.next){case 0:S["a"].getScannedHeight().then((function(e){if("success"===e.data.status){var r=e.data.data.generalScannedHeight;t.cumulusCollateral=r<1076532?1e4:1e3,t.nimbusCollateral=r<1081572?25e3:12500,t.stratusCollateral=r<1087332?1e5:4e4}t.getRates()})),t.getPriceData(),t.getActiveParallelAssets();case 3:case"end":return e.stop()}}),e)})))()},getActiveParallelAssets:function(){var t=this;return Object(c["a"])(Object(s["a"])().mark((function e(){return Object(s["a"])().wrap((function(e){while(1)switch(e.prev=e.next){case 0:F.get("https://fusion.runonflux.io/fees",t.retryOptions).then((function(e){var r=e.data;if("success"===r.status){delete r.data.snapshot.percentage;var a=Object.keys(r.data.snapshot).length;t.activeParallelAssets=a}}));case 1:case"end":return e.stop()}}),e)})))()},getRates:function(){var t=this;return Object(c["a"])(Object(s["a"])().mark((function e(){return Object(s["a"])().wrap((function(e){while(1)switch(e.prev=e.next){case 0:F.get("https://vipdrates.zelcore.io/rates",t.retryOptions).then((function(e){t.rates=e.data,t.getZelNodeCount()}));case 1:case"end":return e.stop()}}),e)})))()},getPriceData:function(){var t=this;return Object(c["a"])(Object(s["a"])().mark((function e(){var r;return Object(s["a"])().wrap((function(e){while(1)switch(e.prev=e.next){case 0:r=t,t.loadingPrice=!0,F.get("https://api.coingecko.com/api/v3/coins/zelcash/market_chart?vs_currency=USD&days=30",t.retryOptions).then((function(e){r.historicalPrices=e.data.prices.filter((function(t){return t[0]>14832324e5}));for(var a=[],n=0;n<r.historicalPrices.length;n+=3){var s=r.historicalPrices[n];a.push(s),t.latestPrice=s[1]}r.lineChart.series=[{name:"Price",data:a}],t.loadingPrice=!1}));case 3:case"end":return e.stop()}}),e)})))()},getZelNodeCount:function(){var t=this;return Object(c["a"])(Object(s["a"])().mark((function e(){var r,a,n;return Object(s["a"])().wrap((function(e){while(1)switch(e.prev=e.next){case 0:return e.next=2,A["a"].zelnodeCount();case 2:r=e.sent,"error"===r.data.status?t.$toast({component:k["a"],props:{title:r.data.data.message||r.data.data,icon:"InfoIcon",variant:"danger"}}):(a=r.data.data,n={},n["stratus-enabled"]=a["stratus-enabled"],n["bamf-enabled"]=a["stratus-enabled"],a["cumulus-enabled"]>a["nimbus-enabled"]?(n["nimbus-enabled"]=a["nimbus-enabled"],n["super-enabled"]=a["nimbus-enabled"],n["cumulus-enabled"]=a["cumulus-enabled"],n["basic-enabled"]=a["cumulus-enabled"]):(n["nimbus-enabled"]=a["cumulus-enabled"],n["super-enabled"]=a["cumulus-enabled"],n["cumulus-enabled"]=a["nimbus-enabled"],n["basic-enabled"]=a["nimbus-enabled"]),t.generateEconomics(n));case 4:case"end":return e.stop()}}),e)})))()},generateEconomics:function(t){var e=this;return Object(c["a"])(Object(s["a"])().mark((function r(){var a,n,c,i,o,l,u,b,f,d,p,m,O,h,g,j;return Object(s["a"])().wrap((function(r){while(1)switch(r.prev=r.next){case 0:return a=2.8125,n=4.6875,c=11.25,r.next=5,A["a"].blockReward();case 5:i=r.sent,"error"===i.data.status?e.$toast({component:k["a"],props:{title:i.data.data.message||i.data.data,icon:"InfoIcon",variant:"danger"}}):(a=(.075*i.data.data.miner).toFixed(4),n=(.125*i.data.data.miner).toFixed(4),c=(.3*i.data.data.miner).toFixed(4)),o=t["stratus-enabled"],l=t["nimbus-enabled"],u=t["cumulus-enabled"],b=720*a*7/u,f=720*n*7/l,d=720*c*7/o,p=e.getFiatRate("FLUX")*a,m=e.getFiatRate("FLUX")*n,O=e.getFiatRate("FLUX")*c,h=5040*p/u,g=5040*m/l,j=5040*O/o,e.cumulusWeek=b,e.nimbusWeek=f,e.stratusWeek=d,e.cumulusUSDRewardWeek=h,e.nimbusUSDRewardWeek=g,e.stratusUSDRewardWeek=j;case 25:case"end":return r.stop()}}),r)})))()},getFiatRate:function(t){var e="USD",r=this.rates[0].find((function(t){return t.code===e}));void 0===r&&(r={rate:0});var a=this.rates[1][t];void 0===a&&(a=0);var n=r.rate*a;return n},beautifyValue:function(t){var e=t.toFixed(2);return e.replace(/(\d)(?=(\d{3})+(?!\d))/g,"$1,")}}},W=U,L=Object(h["a"])(W,a,n,!1,null,null,null);e["default"]=L.exports}}]);