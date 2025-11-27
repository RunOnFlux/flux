import{b as m,r as c,a as f,i as b,x as d}from"./crypto-walletconnect-BoPpUqP0.js";import{n as u}from"./index-D_zm-K7P.js";import{o as h}from"./if-defined-6m10w9Qt.js";import"./index-X_-EJwPv.js";const v=m`
  :host {
    position: relative;
    display: inline-block;
    width: 100%;
  }
`;var o=function(l,i,r,a){var s=arguments.length,e=s<3?i:a===null?a=Object.getOwnPropertyDescriptor(i,r):a,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")e=Reflect.decorate(l,i,r,a);else for(var p=l.length-1;p>=0;p--)(n=l[p])&&(e=(s<3?n(e):s>3?n(i,r,e):n(i,r))||e);return s>3&&e&&Object.defineProperty(i,r,e),e};let t=class extends b{constructor(){super(...arguments),this.disabled=!1}render(){return d`
      <wui-input-text
        type="email"
        placeholder="Email"
        icon="mail"
        size="lg"
        .disabled=${this.disabled}
        .value=${this.value}
        data-testid="wui-email-input"
        tabIdx=${h(this.tabIdx)}
      ></wui-input-text>
      ${this.templateError()}
    `}templateError(){return this.errorMessage?d`<wui-text variant="sm-regular" color="error">${this.errorMessage}</wui-text>`:null}};t.styles=[c,v];o([u()],t.prototype,"errorMessage",void 0);o([u({type:Boolean})],t.prototype,"disabled",void 0);o([u()],t.prototype,"value",void 0);o([u()],t.prototype,"tabIdx",void 0);t=o([f("wui-email-input")],t);
