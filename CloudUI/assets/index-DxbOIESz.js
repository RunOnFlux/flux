import{c,a as f,i as l,x as m}from"./crypto-walletconnect-BoPpUqP0.js";import{n as h}from"./index-D_zm-K7P.js";const p=c`
  :host {
    display: block;
    background: linear-gradient(
      90deg,
      ${({tokens:e})=>e.theme.foregroundSecondary} 0%,
      ${({tokens:e})=>e.theme.foregroundTertiary} 50%,
      ${({tokens:e})=>e.theme.foregroundSecondary} 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1s ease-in-out infinite;
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  :host([data-rounded='true']) {
    border-radius: ${({borderRadius:e})=>e[16]};
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
`;var n=function(e,o,i,s){var d=arguments.length,t=d<3?o:s===null?s=Object.getOwnPropertyDescriptor(o,i):s,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(e,o,i,s);else for(var u=e.length-1;u>=0;u--)(a=e[u])&&(t=(d<3?a(t):d>3?a(o,i,t):a(o,i))||t);return d>3&&t&&Object.defineProperty(o,i,t),t};let r=class extends l{constructor(){super(...arguments),this.width="",this.height="",this.variant="default",this.rounded=!1}render(){return this.style.cssText=`
      width: ${this.width};
      height: ${this.height};
    `,this.dataset.rounded=this.rounded?"true":"false",m`<slot></slot>`}};r.styles=[p];n([h()],r.prototype,"width",void 0);n([h()],r.prototype,"height",void 0);n([h()],r.prototype,"variant",void 0);n([h({type:Boolean})],r.prototype,"rounded",void 0);r=n([f("wui-shimmer")],r);
