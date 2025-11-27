import{c as b,r as p,e as f,a as m,i as v,x as l}from"./crypto-walletconnect-BoPpUqP0.js";import{n as s}from"./index-D_zm-K7P.js";const h=b`
  button {
    border: none;
    background: transparent;
    height: 20px;
    padding: ${({spacing:e})=>e[2]};
    column-gap: ${({spacing:e})=>e[1]};
    border-radius: ${({borderRadius:e})=>e[1]};
    padding: 0 ${({spacing:e})=>e[1]};
    border-radius: ${({spacing:e})=>e[1]};
  }

  /* -- Variants --------------------------------------------------------- */
  button[data-variant='accent'] {
    color: ${({tokens:e})=>e.core.textAccentPrimary};
  }

  button[data-variant='secondary'] {
    color: ${({tokens:e})=>e.theme.textSecondary};
  }

  /* -- Focus states --------------------------------------------------- */
  button:focus-visible:enabled {
    box-shadow: 0px 0px 0px 4px rgba(9, 136, 240, 0.2);
  }

  button[data-variant='accent']:focus-visible:enabled {
    background-color: ${({tokens:e})=>e.core.foregroundAccent010};
  }

  button[data-variant='secondary']:focus-visible:enabled {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  /* -- Hover & Active states ----------------------------------------------------------- */
  button[data-variant='accent']:hover:enabled {
    background-color: ${({tokens:e})=>e.core.foregroundAccent010};
  }

  button[data-variant='secondary']:hover:enabled {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  button[data-variant='accent']:focus-visible {
    background-color: ${({tokens:e})=>e.core.foregroundAccent010};
  }

  button[data-variant='secondary']:focus-visible {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    box-shadow: 0px 0px 0px 4px rgba(9, 136, 240, 0.2);
  }

  button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;var r=function(e,n,a,i){var c=arguments.length,t=c<3?n:i===null?i=Object.getOwnPropertyDescriptor(n,a):i,d;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(e,n,a,i);else for(var u=e.length-1;u>=0;u--)(d=e[u])&&(t=(c<3?d(t):c>3?d(n,a,t):d(n,a))||t);return c>3&&t&&Object.defineProperty(n,a,t),t};const y={sm:"sm-medium",md:"md-medium"},g={accent:"accent-primary",secondary:"secondary"};let o=class extends v{constructor(){super(...arguments),this.size="md",this.disabled=!1,this.variant="accent",this.icon=void 0}render(){return l`
      <button ?disabled=${this.disabled} data-variant=${this.variant}>
        <slot name="iconLeft"></slot>
        <wui-text
          color=${g[this.variant]}
          variant=${y[this.size]}
        >
          <slot></slot>
        </wui-text>
        ${this.iconTemplate()}
      </button>
    `}iconTemplate(){return this.icon?l`<wui-icon name=${this.icon} size="sm"></wui-icon>`:null}};o.styles=[p,f,h];r([s()],o.prototype,"size",void 0);r([s({type:Boolean})],o.prototype,"disabled",void 0);r([s()],o.prototype,"variant",void 0);r([s()],o.prototype,"icon",void 0);o=r([m("wui-link")],o);
