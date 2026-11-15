// Anzeigehilfe, keine Aussage über den tatsächlichen Shopify-Zahlungsmodus.
// Die Shop-/Kundenfreigabe und Shopify-Kassenlogik bleiben unverändert.
export function demoPaymentModeNotice(customer){
 if(!customer||typeof customer!=='object'||Array.isArray(customer)||customer.demo_delta_aktiv!==true)return '';
 return 'SMA-Demo ist aktiv. Ob Shopify Payments aktuell im Testmodus ist, kann SMA nicht automatisch prüfen. Vor einem Testkauf bitte im Shopify-Admin kontrollieren.';
}
