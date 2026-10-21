/** Uiverse adaptation credits and MIT notices: docs/uiverse-attribution.md. */
export default function LoadingState({label,compact=false}:{label:string;compact?:boolean}){
 return <div className={`loading-state${compact?' loading-state-compact':' atlas-dot-surface'}`} data-compact={compact} role="status" aria-live="polite" aria-atomic="true">
  <span className="atlas-loading-bars" aria-hidden="true"><span/><span/><span/></span>
  <span className="loading-state-label">{label}</span>
 </div>;
}
