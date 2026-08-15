/**
 * models.js — Gemini Model Dictionary & Mapping Configurations
 */

export const MODELS = [
  {
    id: '3.7-flash',
    name: '3.7 Flash',
    shortName: '3.7 Flash',
    backendId: 'gemini-3.7-flash',
    thinkingLevels: ['minimal', 'low', 'medium', 'high'],
    defaultThinkingLevel: 'medium',
    badge: 'Fast',
    description: 'Fast, smart, and multimodal everyday intelligence'
  },
  {
    id: '3.5-flash',
    name: '3.5 Flash',
    shortName: '3.5 Flash',
    backendId: 'gemini-3.5-flash',
    thinkingLevels: ['minimal', 'low', 'medium', 'high'],
    defaultThinkingLevel: 'medium',
    badge: 'Balanced',
    description: 'Balanced speed and performance'
  },
  {
    id: '3.5-flash-light',
    name: '3.5 Lite',
    shortName: '3.5 Lite',
    backendId: 'gemini-3.5-flash-lite',
    thinkingLevels: ['minimal', 'low', 'medium', 'high'],
    defaultThinkingLevel: 'minimal',
    badge: 'Lite',
    description: 'Ultra lightweight and rapid responses'
  },
  {
    id: '3.1-pro',
    name: '3.1 Pro',
    shortName: '3.1 Pro',
    backendId: 'gemini-3.1-pro-preview',
    thinkingLevels: ['low', 'medium', 'high'],
    defaultThinkingLevel: 'high',
    badge: 'Pro',
    description: 'Deep reasoning, complex coding, and analysis'
  }
];

export function getBackendModelId(uiName) {
  const match = MODELS.find(m => m.name === uiName || m.id === uiName || m.shortName === uiName);
  return match ? match.backendId : null;
}

export function getModelConfig(uiName) {
  return MODELS.find(m => m.name === uiName || m.id === uiName || m.shortName === uiName) || MODELS[0];
}
