/* Stable app.js entry point; feature modules own their state and listeners. */
window.AIUIFactory = function (ctx) {
  let settings;
  const UIAI = window.createAIChatUI(ctx, () => settings.openAISettings());
  const UIArchive = window.createAIArchiveUI({ ...ctx, UIAI });
  settings = window.createAISettingsUI({ ...ctx, UIAI });
  window.AIWorkspace = window.AIGenerationFactory({ ...ctx, UIAI, UIArchive });
  window.createAIConversationLayout({ ...ctx, UIAI, UIArchive });
  return { UIAI, UIArchive };
};
