import{c as u,r as p,a as m,i as f,x as h}from"./crypto-walletconnect-BoPpUqP0.js";import{n as o}from"./index-D_zm-K7P.js";import"./index-CV0VcXMx.js";import"./index-D1jicTFt.js";const w=u`
  :host {
    position: relative;
    background-color: ${({tokens:e})=>e.theme.foregroundTertiary};
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: inherit;
    border-radius: var(--local-border-radius);
  }

  :host([data-image='true']) {
    background-color: transparent;
  }

  :host > wui-flex {
    overflow: hidden;
    border-radius: inherit;
    border-radius: var(--local-border-radius);
  }

  :host([data-size='sm']) {
    width: 32px;
    height: 32px;
  }

  :host([data-size='md']) {
    width: 40px;
    height: 40px;
  }

  :host([data-size='lg']) {
    width: 56px;
    height: 56px;
  }

  :host([name='Extension'])::after {
    border: 1px solid ${({colors:e})=>e.accent010};
  }

  :host([data-wallet-icon='allWallets'])::after {
    border: 1px solid ${({colors:e})=>e.accent010};
  }

  wui-icon[data-parent-size='inherit'] {
    width: 75%;
    height: 75%;
    align-items: center;
  }

  wui-icon[data-parent-size='sm'] {
    width: 32px;
    height: 32px;
  }

  wui-icon[data-parent-size='md'] {
    width: 40px;
    height: 40px;
  }

  :host > wui-icon-box {
    position: absolute;
    overflow: hidden;
    right: -1px;
    bottom: -2px;
    z-index: 1;
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
    padding: 1px;
  }
`;var a=function(e,t,s,n){var l=arguments.length,r=l<3?t:n===null?n=Object.getOwnPropertyDescriptor(t,s):n,d;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,s,n);else for(var c=e.length-1;c>=0;c--)(d=e[c])&&(r=(l<3?d(r):l>3?d(t,s,r):d(t,s))||r);return l>3&&r&&Object.defineProperty(t,s,r),r};let i=class extends f{constructor(){super(...arguments),this.size="md",this.name="",this.installed=!1,this.badgeSize="xs"}render(){let t="1";return this.size==="lg"?t="4":this.size==="md"?t="2":this.size==="sm"&&(t="1"),this.style.cssText=`
       --local-border-radius: var(--apkt-borderRadius-${t});
   `,this.dataset.size=this.size,this.imageSrc&&(this.dataset.image="true"),this.walletIcon&&(this.dataset.walletIcon=this.walletIcon),h`
      <wui-flex justifyContent="center" alignItems="center"> ${this.templateVisual()} </wui-flex>
    `}templateVisual(){return this.imageSrc?h`<wui-image src=${this.imageSrc} alt=${this.name}></wui-image>`:this.walletIcon?h`<wui-icon size="md" color="default" name=${this.walletIcon}></wui-icon>`:h`<wui-icon
      data-parent-size=${this.size}
      size="inherit"
      color="inherit"
      name="wallet"
    ></wui-icon>`}};i.styles=[p,w];a([o()],i.prototype,"size",void 0);a([o()],i.prototype,"name",void 0);a([o()],i.prototype,"imageSrc",void 0);a([o()],i.prototype,"walletIcon",void 0);a([o({type:Boolean})],i.prototype,"installed",void 0);a([o()],i.prototype,"badgeSize",void 0);i=a([m("wui-wallet-image")],i);
