const roster = 'html[data-blackbaud-next-appearance] #site-main[data-bn-page="class"] #academicclassmaincontainer';
const card = `${roster} .roster-card`;
const content = `${card} > .bb-card-content`;
const profileRow = `:is(${content} > .row, ${content} > bb-card-content > .row):not([hidden]):has(> .col-md-4:first-child + .col-md-8:last-child):has(> .col-md-4 > .bb-avatar-wrapper > img.bb-avatar-image):has(> .col-md-8 h1.bb-card-title)`;

export const ROSTER_STYLES = `
${card} { border-color: var(--bn-border); border-radius: var(--bn-radius); box-shadow: none; }
${card} .bb-card-content { color: var(--bn-muted); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
${card} h1.bb-card-title { margin: 0; color: var(--bn-text); font-size: 17px; font-weight: 500; line-height: 1.4; letter-spacing: 0; overflow-wrap: anywhere; }
/* Keep the native role-header space aligned with the other cards. */
${card} > header .bb-card-title { color: var(--bn-muted); font-size: 12px; font-weight: 600; line-height: 25px; }
${card} .contactCardP { margin: 0; color: var(--bn-muted); font-size: 13px; font-weight: 400; line-height: 1.6; }
${card} .contactCardP a { font: inherit; }
/* The native spacer has inline padding between the name and email. */
${card} .bb-card-content h1.bb-card-title + div:not(:has(*)):has(+ .contactCardP) { padding-block: 2px !important; }
${card} > .bb-card-actions { border-color: var(--bn-border); border-radius: 0 0 var(--bn-radius) var(--bn-radius); }
${roster} #rosterSearchField::placeholder { color: var(--bn-muted); font-style: normal; opacity: 1; }
@media (min-width: 992px) {
  ${profileRow} { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 16px; margin-inline: 0; }
  ${profileRow}::before, ${profileRow}::after { display: none; }
  ${profileRow} > :is(.col-md-4, .col-md-8) { float: none; width: auto; min-width: 0; padding-inline: 0 !important; }
}
`;
