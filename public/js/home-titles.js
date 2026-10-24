// Owner: member 1
// Home page, DISPLAY ONLY: the demo data from `npm run seed` has placeholder text ("כתבה לדוגמה מספר 359",
// "תקציר קצר של כתבה 359."). This script shows a readable Hebrew headline and summary instead, chosen from the
// article's category and number. The database and the API are not changed (so search still matches the stored
// text, and the article page still shows the stored text). Real articles never match the placeholder pattern.
(function () {
  // the seed adds "(גרסה קודמת)" and a sentence to live articles that have a pending update: those match too
  const TITLE_RE = /^כתבה לדוגמה מספר (\d+)( \(גרסה קודמת\))?$/;
  const SUMMARY_RE = /^תקציר קצר של כתבה (\d+)\./;

  const TOPICS = {
    politics: ['הממשלה', 'הכנסת', 'ועדת הכספים', 'המערכת הפוליטית', 'הקואליציה', 'האופוזיציה', 'הרשויות המקומיות', 'מערכת הבחירות', 'בית המשפט העליון', 'משרד החוץ', 'הדיון בתקציב', 'הרפורמה החדשה'],
    economy: ['שוק המניות', 'הריבית בישראל', 'מחירי הדיור', 'יוקר המחיה', 'שוק העבודה', 'הבורסה בתל אביב', 'עולם הסטארטאפים', 'מחירי האנרגיה', 'הדולר והשקל', 'ענף הבנקאות', 'הייצוא הישראלי', 'התקציב הלאומי'],
    sports: ['ליגת העל', 'נבחרת ישראל', 'הכדורסל הישראלי', 'משחקי הדרבי', 'אליפות אירופה', 'הטניס הישראלי', 'עונת הכדורגל', 'ענף האתלטיקה', 'הנבחרת האולימפית', 'הכדורעף', 'הג׳ודו הישראלי', 'מחזור הליגה'],
    tech: ['הבינה המלאכותית', 'אבטחת המידע', 'הסייבר הישראלי', 'הסמארטפונים החדשים', 'עולם הרובוטיקה', 'חברות הענן', 'הרכבים החשמליים', 'תעשיית השבבים', 'האפליקציות החדשות', 'הטכנולוגיה הרפואית', 'עולם הגיימינג', 'מרחב האינטרנט'],
    culture: ['התיאטרון הישראלי', 'הקולנוע המקומי', 'פסטיבל הסרטים', 'המוזיקה הישראלית', 'עולם הספרות', 'תערוכות האמנות', 'הבמה והמחול', 'הטלוויזיה בישראל', 'הסדרות החדשות', 'המוזיאונים בישראל', 'פסטיבלי הקיץ', 'עולם הקומיקס'],
    health: ['בריאות הציבור', 'התזונה הנכונה', 'הפעילות הגופנית', 'שיטות טיפול חדשות', 'בריאות הנפש', 'מחקרי הרפואה', 'קופות החולים', 'החיסונים', 'השינה הבריאה', 'הרפואה המונעת', 'מחלות העונה', 'בתי החולים'],
  };
  const ANGLES = ['מה צפוי בשבוע הקרוב', 'כל מה שצריך לדעת', 'הנתונים החדשים', 'ניתוח מעמיק', 'מבט מקרוב', 'מה עומד מאחורי המהלך',
    'ההשלכות לטווח הארוך', 'ההסבר המלא', 'מה השתנה השנה', 'למה זה חשוב עכשיו', 'הצצה לתמונה הגדולה', 'השאלות שנשארו פתוחות'];
  const SUMMARIES = [
    'ההתפתחויות האחרונות מעלות שאלות חדשות, והמומחים מנסים להבין לאן הדברים הולכים.',
    'סקירה של הנתונים העדכניים ושל מה שהם מלמדים על התקופה הקרובה.',
    'מה אומרים המומחים, מה אומרים הנתונים, ומה כדאי לעקוב אחריו בימים הקרובים.',
    'הרקע, הגורמים המעורבים והשינויים שצפויים להשפיע על כולנו.',
    'מבט מעמיק על המגמות שמעצבות את התחום, עם תובנות מהשטח.',
    'כך נראית התמונה כרגע, ומה עשוי להשתנות בהמשך השנה.',
    'הסבר פשוט וברור לנושא שמעסיק את הציבור בימים אלה.',
    'שיחה עם העוסקים בתחום על האתגרים, ההזדמנויות והצעדים הבאים.',
    'עיקרי הדברים, בלי הרעש: מה קרה, למה זה חשוב ומה הלאה.',
    'דוח חדש מציג תמונת מצב מעודכנת ומצביע על כמה מגמות בולטות.',
    'ההחלטות שהתקבלו לאחרונה והמשמעות שלהן עבור הקוראים.',
    'לקט של העדכונים החשובים ביותר, עם הקשר וניתוח קצר.',
  ];

  function headline(category, n) {
    const topics = TOPICS[category] || TOPICS.politics;
    return topics[n % topics.length] + ': ' + ANGLES[Math.floor(n / topics.length) % ANGLES.length];
  }

  function fix(el) {
    const category = (el.closest('[data-category]') || {}).dataset && el.closest('[data-category]').dataset.category;
    let match = TITLE_RE.exec(el.textContent.trim());
    if (match) {
      el.textContent = headline(category, Number(match[1]));
      return;
    }
    match = SUMMARY_RE.exec(el.textContent.trim());
    if (match) el.textContent = SUMMARIES[Number(match[1]) % SUMMARIES.length];
  }

  const SELECTOR = '.card-title, .strip-title, .featured-title, .list-title, .card-summary, .strip-summary, .featured-summary';
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches(SELECTOR)) fix(root);
    root.querySelectorAll(SELECTOR).forEach(fix);
  }

  scan(document.body);
  // cards that the infinite scroll adds later
  new MutationObserver((mutations) => {
    mutations.forEach((m) => m.addedNodes.forEach(scan));
  }).observe(document.getElementById('feed') || document.body, { childList: true, subtree: true });
}());
