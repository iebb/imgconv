import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLocale, languageInfo, languages, messages, normalizeLocale, number, setLocale, t } from '../src/i18n';
import { AppError, issue } from '../src/errors';

const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
test('Ten complete translations preserve every named parameter', () => {
  assert.equal(languages.length, 10);
  const keys = Object.keys(messages.en).sort();
  for (const { code } of languages) {
    const dictionary = messages[code];
    assert.deepEqual(Object.keys(dictionary).sort(), keys, code);
    for (const key of keys as (keyof typeof dictionary)[]) {
      assert.ok(dictionary[key].trim().length > 0, code + ': ' + key);
      assert.deepEqual(placeholders(dictionary[key]), placeholders(messages.en[key]), code + ': ' + key);
      if (['appTitle','home','about','aboutTitle','aboutPrivacy'].includes(key)) assert.ok(!/\bStill\b/.test(dictionary[key]), code + ': old branding');
    }
    assert.ok(dictionary.appTitle.startsWith('resz.im'));
    assert.ok(dictionary.aboutPrivacy.includes('resz.im'));
    if (code !== 'en') {
      const translated = keys.filter(key => dictionary[key as keyof typeof dictionary] !== messages.en[key as keyof typeof dictionary]);
      assert.ok(translated.length / keys.length > .95, code + ': untranslated copy');
    }
  }
});
test('Explicit, saved, browser, and fallback language selection', () => {
  assert.equal(detectLocale('ar-SA', 'fr', ['en']), 'ar');
  assert.equal(detectLocale('unsupported', 'pt-BR', ['en']), 'pt');
  assert.equal(detectLocale(null, null, ['ja-JP','bn-BD','en']), 'bn');
  assert.equal(detectLocale(null, 'unsupported', ['ja-JP']), 'en');
  assert.equal(normalizeLocale('zh_CN'), 'zh-Hans');
  assert.equal(normalizeLocale('HI-in'), 'hi');
  assert.equal(normalizeLocale('in-ID'), 'id');
  assert.equal(normalizeLocale(''), null);
});
test('Arabic and Urdu use RTL; other supported languages use LTR', () => {
  for (const {code} of languages) assert.equal(languageInfo(code).direction, ['ar','ur'].includes(code) ? 'rtl' : 'ltr');
});
test('Numbers and dynamic messages follow the selected locale', () => {
  setLocale('bn');
  assert.equal(number(1234), new Intl.NumberFormat('bn').format(1234));
  assert.ok(t('progress', { current: 2, total: 10 }).includes(number(10)));
  assert.ok(!t('progress', { current: 2, total: 10 }).includes('{'));
  assert.ok(t('previewFile', {file:'mountain.png'}, 'ar').includes('mountain.png'));
  assert.notEqual(t('errorLimitTiny', {limit:1}, 'ar'), t('errorLimitTiny', {limit:1}, 'en'));
  setLocale('en');
});
test('Worker errors retain stable codes and parameters without English leakage', () => {
  assert.deepEqual(issue(new AppError('errorLimitTiny',{limit:1})),{code:'errorLimitTiny',params:{limit:1}});
  assert.deepEqual(issue(new Error('private decoder detail')),{code:'errorDecode',params:{}});
});
