/// <reference types="vite/client" />

// CSS Modules 类型声明（Vite 原生支持，此处仅为 TS 识别 .module.css 导入）
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
