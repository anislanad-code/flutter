const QUESTIONS: ReadonlyArray<{ question: string; reponse: string }> = [
  {
    question: "Je n'ai jamais programmé. Je peux suivre cette formation ?",
    reponse:
      "Oui. Le module 0 part de zéro : installer les outils, écrire ton premier widget, comprendre comment Flutter réagit à un changement. Aucune expérience de programmation n'est supposée.",
  },
  {
    question: "Comment je paye si je n'ai pas de carte bancaire internationale ?",
    reponse:
      "Par versement CCP. Une fois ton compte créé, tu vois le numéro et le montant exact, tu verses, puis tu téléverses une photo du reçu depuis ton espace. La validation prend en général moins de 24 h.",
  },
  {
    question: "J'ai seulement mon téléphone Android, pas d'ordinateur.",
    reponse:
      "Le site fonctionne sur mobile, mais Flutter demande un vrai poste de développement (Android Studio, un émulateur). Compte sur un accès occasionnel à un ordinateur pour la partie pratique.",
  },
  {
    question: "Qu'est-ce qui est gratuit, exactement ?",
    reponse:
      "Le premier chapitre du module 0 est ouvert à tout le monde, sans compte payant : installer Flutter et configurer ton éditeur. Tu le lis en entier avant de décider de payer.",
  },
  {
    question: "Combien de temps pour terminer la formation ?",
    reponse:
      "Ça dépend du temps que tu y consacres, mais compte plusieurs semaines pour aller du module 0 à une application Flutter + Firebase publiée.",
  },
];

export function Faq() {
  return (
    <section aria-labelledby="titre-faq" className="border-t border-muted/40 py-16">
      <h2 id="titre-faq" className="font-titre text-[length:var(--texte-2xl)] font-semibold">
        Questions fréquentes
      </h2>
      <dl className="mt-8 flex max-w-mesure flex-col divide-y divide-muted/40">
        {QUESTIONS.map(({ question, reponse }) => (
          <div key={question} className="py-5">
            <dt className="font-titre text-[length:var(--texte-base)] font-semibold">
              {question}
            </dt>
            <dd className="mt-2 text-[length:var(--texte-base)] text-ink">{reponse}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
