import { describe, expect, it } from 'vitest';
import {
  MSG_OPEN_POPUP,
  MSG_SAVE_SELECTION,
  MSG_SHOW_TOAST,
  isOpenPopupMessage,
  isSaveSelectionMessage,
  saveSelectionMessage,
  toastMessage,
} from '../src/lib/message.js';

describe('message contract builders (Δ7)', () => {
  it('saveSelectionMessage always emits {type, text} with a string text', () => {
    expect(saveSelectionMessage('hello')).toEqual({
      type: MSG_SAVE_SELECTION,
      text: 'hello',
    });
    // Issue #4 command path: text grabbed in the content script → text:''.
    expect(saveSelectionMessage('')).toEqual({
      type: MSG_SAVE_SELECTION,
      text: '',
    });
    // Non-string input is coerced to '' (never an undefined/absent key).
    expect(saveSelectionMessage(undefined)).toEqual({
      type: MSG_SAVE_SELECTION,
      text: '',
    });
  });

  it('toastMessage emits {type:"SHOW_TOAST", message} with a string message', () => {
    expect(toastMessage('Saved ✓')).toEqual({ type: MSG_SHOW_TOAST, message: 'Saved ✓' });
    expect(toastMessage(null)).toEqual({ type: MSG_SHOW_TOAST, message: '' });
  });
});

describe('message-shape validation', () => {
  it('accepts the PROMPTY_SAVE_SELECTION payload shape (empty or filled text)', () => {
    expect(isSaveSelectionMessage({ type: MSG_SAVE_SELECTION, text: 'hi' })).toBe(true);
    expect(isSaveSelectionMessage({ type: MSG_SAVE_SELECTION, text: '' })).toBe(true);
  });

  it('rejects missing/wrong text key and wrong type for PROMPTY_SAVE_SELECTION', () => {
    expect(isSaveSelectionMessage({ type: MSG_SAVE_SELECTION })).toBe(false);
    expect(isSaveSelectionMessage({ type: MSG_SAVE_SELECTION, text: 5 })).toBe(false);
    expect(isSaveSelectionMessage({ text: 'hi' })).toBe(false);
    expect(isSaveSelectionMessage({ type: 'OTHER' })).toBe(false);
    expect(isSaveSelectionMessage('PROMPTY_SAVE_SELECTION')).toBe(false);
    expect(isSaveSelectionMessage(null)).toBe(false);
  });

  it('accepts {type:"OPEN_POPUP"} and rejects everything else', () => {
    expect(isOpenPopupMessage({ type: MSG_OPEN_POPUP })).toBe(true);
    expect(isOpenPopupMessage({ type: MSG_OPEN_POPUP, text: 'hi' })).toBe(true);
    expect(isOpenPopupMessage({ type: MSG_SAVE_SELECTION, text: '' })).toBe(false);
    expect(isOpenPopupMessage({})).toBe(false);
    expect(isOpenPopupMessage(null)).toBe(false);
  });
});
