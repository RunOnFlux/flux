import{c as h,r as f,a as u,i as m,x as v,U as p}from"./crypto-walletconnect-BoPpUqP0.js";import{n as d}from"./index-D_zm-K7P.js";import"./index-CV0VcXMx.js";const x=h`
  :host {
    display: block;
    width: var(--local-width);
    height: var(--local-height);
    border-radius: ${({borderRadius:r})=>r[16]};
    overflow: hidden;
    position: relative;
  }

  :host([data-variant='generated']) {
    --mixed-local-color-1: var(--local-color-1);
    --mixed-local-color-2: var(--local-color-2);
    --mixed-local-color-3: var(--local-color-3);
    --mixed-local-color-4: var(--local-color-4);
    --mixed-local-color-5: var(--local-color-5);
  }

  :host([data-variant='generated']) {
    background: radial-gradient(
      var(--local-radial-circle),
      #fff 0.52%,
      var(--mixed-local-color-5) 31.25%,
      var(--mixed-local-color-3) 51.56%,
      var(--mixed-local-color-2) 65.63%,
      var(--mixed-local-color-1) 82.29%,
      var(--mixed-local-color-4) 100%
    );
  }

  :host([data-variant='default']) {
    background: radial-gradient(
      75.29% 75.29% at 64.96% 24.36%,
      #fff 0.52%,
      #f5ccfc 31.25%,
      #dba4f5 51.56%,
      #9a8ee8 65.63%,
      #6493da 82.29%,
      #6ebdea 100%
    );
  }
`;var o=function(r,a,l,i){var s=arguments.length,e=s<3?a:i===null?i=Object.getOwnPropertyDescriptor(a,l):i,c;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")e=Reflect.decorate(r,a,l,i);else for(var n=r.length-1;n>=0;n--)(c=r[n])&&(e=(s<3?c(e):s>3?c(a,l,e):c(a,l))||e);return s>3&&e&&Object.defineProperty(a,l,e),e};let t=class extends m{constructor(){super(...arguments),this.imageSrc=void 0,this.alt=void 0,this.address=void 0,this.size="xl"}render(){const a={inherit:"inherit",xxs:"3",xs:"5",sm:"6",md:"8",mdl:"8",lg:"10",xl:"16",xxl:"20"};return this.style.cssText=`
    --local-width: var(--apkt-spacing-${a[this.size??"xl"]});
    --local-height: var(--apkt-spacing-${a[this.size??"xl"]});
    `,v`${this.visualTemplate()}`}visualTemplate(){if(this.imageSrc)return this.dataset.variant="image",v`<wui-image src=${this.imageSrc} alt=${this.alt??"avatar"}></wui-image>`;if(this.address){this.dataset.variant="generated";const a=p.generateAvatarColors(this.address);return this.style.cssText+=`
 ${a}`,null}return this.dataset.variant="default",null}};t.styles=[f,x];o([d()],t.prototype,"imageSrc",void 0);o([d()],t.prototype,"alt",void 0);o([d()],t.prototype,"address",void 0);o([d()],t.prototype,"size",void 0);t=o([u("wui-avatar")],t);
