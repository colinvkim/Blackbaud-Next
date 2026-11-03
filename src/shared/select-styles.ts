import { ChevronDown } from 'lucide';

const chevronShapes = ChevronDown.map(([tag, attributes]) => {
  const values = Object.entries(attributes).filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}="${value}"`).join(' ');
  return `<${tag} ${values}/>`;
}).join('');
const chevron = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#657080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${chevronShapes}</svg>`)}")`;

export function selectStyles(selector: string): string {
  const control = `${selector}:not([multiple]):not([size]:not([size="1"]))`;
  return `
${control} { appearance: none; padding-inline-end: 36px; background-image: ${chevron}; background-repeat: no-repeat; background-position: right 12px center; background-size: 16px 16px; }
${control}:dir(rtl) { background-position: left 12px center; }
@media (forced-colors: active) { ${control} { appearance: auto; background-image: none; } }
`;
}
