import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../services/api.js', () => ({
  resolveEnglishBaseType: vi.fn(),
}));

vi.mock('../services/poe2scout.js', () => ({
  lookupUniquePriceFromScout: vi.fn(),
}));

vi.mock('../services/repoe.js', () => ({
  lookupBaseItem: vi.fn(),
  lookupBaseItemByClass: vi.fn(),
  matchAllModTiers: vi.fn(),
}));

import { resolveEnglishBaseType } from '../services/api.js';
import { lookupUniquePriceFromScout } from '../services/poe2scout.js';
import { lookupBaseItem, lookupBaseItemByClass, matchAllModTiers } from '../services/repoe.js';
import { registerItemParserTools } from './item.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}>;

function extractHandlers() {
  const handlers = new Map<string, ToolHandler>();
  const mockServer = {
    registerTool: vi.fn((name: string, _opts: unknown, fn: ToolHandler) => {
      handlers.set(name, fn);
    }),
  } as unknown as McpServer;
  registerItemParserTools(mockServer);
  return handlers;
}

describe('poe2_parse_item', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.restoreAllMocks();
    handler = extractHandlers().get('poe2_parse_item')!;
  });

  describe('Russian wand example from spec appendix', () => {
    const russianWandText = `Класс предмета: Жезлы
Редкость: Редкий
Чумное проклятие
Увядший жезл
--------
Качество: +20% (augmented)
--------
Требуется: Уровень 41, 55 (augmented) Инт
--------
Гнезда: S
--------
Уровень предмета: 41
--------
25% увеличение урона от чар (rune)
--------
Дарует умение: Снаряд хаоса 11 уровня
91% увеличение урона от чар
+84 к максимуму маны
25% снижение требований к характеристикам
38% повышение шанса критического удара для чар
+16 к интеллекту`;

    it('parses header correctly', async () => {
      const result = await handler({ text: russianWandText });

      expect(result.content[0]!.text).toContain('## Чумное проклятие');
      expect(result.content[0]!.text).toContain('**Rare Жезлы**');
      expect(result.content[0]!.text).toContain('Увядший жезл');
    });

    it('parses quality with augmented marker', async () => {
      const result = await handler({ text: russianWandText });

      expect(result.content[0]!.text).toContain('**Quality:** 20%');
      expect(result.content[0]!.text).toContain('(augmented)');
    });

    it('parses item level', async () => {
      const result = await handler({ text: russianWandText });

      expect(result.content[0]!.text).toContain('**Item Level:** 41');
    });

    it('parses sockets', async () => {
      const result = await handler({ text: russianWandText });

      expect(result.content[0]!.text).toContain('### Sockets');
      expect(result.content[0]!.text).toContain('S');
    });

    it('parses requirements with level', async () => {
      const result = await handler({ text: russianWandText });

      expect(result.content[0]!.text).toContain('### Requirements');
      expect(result.content[0]!.text).toContain('**Level:** 41');
    });

    it('categorizes rune mods separately', async () => {
      const result = await handler({ text: russianWandText });

      expect(result.content[0]!.text).toContain('**Rune:**');
      expect(result.content[0]!.text).toContain('25% увеличение урона от чар');
    });

    it('parses explicit mods', async () => {
      const result = await handler({ text: russianWandText });

      expect(result.content[0]!.text).toContain('**Explicit:**');
      expect(result.content[0]!.text).toContain('91% увеличение урона от чар');
      expect(result.content[0]!.text).toContain('+84 к максимуму маны');
      expect(result.content[0]!.text).toContain('+16 к интеллекту');
    });

    it('extracts granted skills', async () => {
      const result = await handler({ text: russianWandText });

      expect(result.content[0]!.text).toContain('### Granted Skills');
      expect(result.content[0]!.text).toContain('Снаряд хаоса 11 уровня');
    });

    it('detects Russian language', async () => {
      const result = await handler({ text: russianWandText });

      expect(result.content[0]!.text).toContain('*Detected language: ru*');
    });
  });

  describe('currency/stackable items', () => {
    const currencyText = `Item Class: Stackable Currency
Rarity: Currency
Chaos Orb
--------
Stack Size: 7/20
--------
Reforges a rare item with new random modifiers`;

    it('parses currency rarity', async () => {
      const result = await handler({ text: currencyText });

      expect(result.content[0]!.text).toContain('**Currency Stackable Currency**');
    });

    it('parses stack size', async () => {
      const result = await handler({ text: currencyText });

      expect(result.content[0]!.text).toContain('**Stack:** 7/20');
    });

    it('parses currency description as mod', async () => {
      const result = await handler({ text: currencyText });

      expect(result.content[0]!.text).toContain('Reforges a rare item with new random modifiers');
    });
  });

  describe('corrupted unique with implicit mods', () => {
    const corruptedUniqueText = `Item Class: Rings
Rarity: Unique
Doedre's Damning
Paua Ring
--------
Requires Level 45
--------
+12 to maximum Energy Shield (implicit)
--------
+25% to Chaos Resistance
Curse Enemies with Despair on Hit
+30 to maximum Mana
--------
Corrupted`;

    it('parses unique rarity', async () => {
      const result = await handler({ text: corruptedUniqueText });

      expect(result.content[0]!.text).toContain('**Unique Rings**');
      expect(result.content[0]!.text).toContain("Doedre's Damning");
    });

    it('categorizes implicit mods separately', async () => {
      const result = await handler({ text: corruptedUniqueText });

      expect(result.content[0]!.text).toContain('**Implicit:**');
      expect(result.content[0]!.text).toContain('+12 to maximum Energy Shield');
    });

    it('parses explicit mods', async () => {
      const result = await handler({ text: corruptedUniqueText });

      expect(result.content[0]!.text).toContain('**Explicit:**');
      expect(result.content[0]!.text).toContain('+25% to Chaos Resistance');
      expect(result.content[0]!.text).toContain('Curse Enemies with Despair on Hit');
    });

    it('detects corrupted flag', async () => {
      const result = await handler({ text: corruptedUniqueText });

      expect(result.content[0]!.text).toContain('### Flags');
      expect(result.content[0]!.text).toContain('Corrupted');
    });
  });

  describe('English rare armor with defensive stats', () => {
    const armorText = `Item Class: Body Armours
Rarity: Rare
Soul Shell
Full Plate
--------
Quality: +18% (augmented)
Armour: 542 (augmented)
Energy Shield: 85 (augmented)
--------
Requires Level 52, 78 Str, 45 Int
--------
Sockets: S S
--------
Item Level: 60
--------
+45 to maximum Life
+32% to Fire Resistance
+18% to Cold Resistance
12% increased Armour`;

    it('parses defensive stats with augmented markers', async () => {
      const result = await handler({ text: armorText });

      expect(result.content[0]!.text).toContain('### Defenses');
      expect(result.content[0]!.text).toContain('**Armour:** 542 (augmented)');
      expect(result.content[0]!.text).toContain('**Energy Shield:** 85 (augmented)');
    });

    it('parses multiple sockets', async () => {
      const result = await handler({ text: armorText });

      expect(result.content[0]!.text).toContain('### Sockets');
      expect(result.content[0]!.text).toContain('S S');
    });

    it('parses strength and intelligence requirements', async () => {
      const result = await handler({ text: armorText });

      expect(result.content[0]!.text).toContain('**Level:** 52');
      expect(result.content[0]!.text).toMatch(/Strength.*78/);
      expect(result.content[0]!.text).toMatch(/Intelligence.*45/);
    });
  });

  describe('weapon with offensive stats', () => {
    const weaponText = `Item Class: Two Hand Maces
Rarity: Rare
Beast Bane
Great Mallet
--------
Physical Damage: 45-89 (augmented)
Critical Strike Chance: 5.00%
Attacks per Second: 1.25
--------
Requires Level 35, 95 Str
--------
Item Level: 38
--------
+15 to Strength
35% increased Physical Damage
Adds 5 to 10 Physical Damage`;

    it('parses physical damage range with augmented marker', async () => {
      const result = await handler({ text: weaponText });

      expect(result.content[0]!.text).toContain('### Offense');
      expect(result.content[0]!.text).toContain('**Physical Damage:** 45-89 (augmented)');
    });

    it('parses critical chance', async () => {
      const result = await handler({ text: weaponText });

      expect(result.content[0]!.text).toContain('**Critical Chance:** 5%');
    });

    it('parses attack speed', async () => {
      const result = await handler({ text: weaponText });

      expect(result.content[0]!.text).toContain('**Attacks per Second:** 1.25');
    });
  });

  describe('unidentified item', () => {
    const unidentifiedText = `Item Class: Boots
Rarity: Rare
Unidentified
Deicide Boots
--------
Requires Level 60
--------
Unidentified`;

    it('detects unidentified flag', async () => {
      const result = await handler({ text: unidentifiedText });

      expect(result.content[0]!.text).toContain('### Flags');
      expect(result.content[0]!.text).toContain('Unidentified');
    });
  });

  describe('mirrored item', () => {
    const mirroredText = `Item Class: Amulets
Rarity: Rare
Dragon Pendant
Coral Amulet
--------
Requires Level 20
--------
Item Level: 25
--------
+30 to maximum Life
--------
Mirrored`;

    it('detects mirrored flag', async () => {
      const result = await handler({ text: mirroredText });

      expect(result.content[0]!.text).toContain('### Flags');
      expect(result.content[0]!.text).toContain('Mirrored');
    });
  });

  describe('normal item (no name)', () => {
    const normalText = `Item Class: Helmets
Rarity: Normal
Iron Hat
--------
Armour: 25
--------
Requires Level 3
--------
Item Level: 5`;

    it('uses base type as display name', async () => {
      const result = await handler({ text: normalText });

      expect(result.content[0]!.text).toContain('## Iron Hat');
      expect(result.content[0]!.text).toContain('**Normal Helmets**');
    });
  });

  describe('normal item with inline defensive stats', () => {
    const normalBody = `Item Class: Body Armours
Rarity: Normal
Keth Raiment

Energy Shield: 70
--------
Requirements:
Level: 35
Int: 67
--------
Item Level: 35`;

    it('parses Energy Shield from header section', async () => {
      const result = await handler({ text: normalBody });
      const output = result.content[0]!.text;

      expect(output).toContain('**Energy Shield:** 70');
    });

    it('parses base type', async () => {
      const result = await handler({ text: normalBody });
      const output = result.content[0]!.text;

      expect(output).toContain('## Keth Raiment');
    });

    it('parses requirements', async () => {
      const result = await handler({ text: normalBody });
      const output = result.content[0]!.text;

      expect(output).toContain('**Level:** 35');
      expect(output).toContain('**Intelligence:** 67');
    });
  });

  describe('normal item with inline armour stat', () => {
    const normalShield = `Item Class: Shields
Rarity: Normal
Twig Shield

Armour: 18
Block Chance: 25%
--------
Requires Level 2
--------
Item Level: 3`;

    it('parses Armour from header section', async () => {
      const result = await handler({ text: normalShield });
      const output = result.content[0]!.text;

      expect(output).toContain('**Armour:** 18');
    });

    it('parses Block Chance from header section', async () => {
      const result = await handler({ text: normalShield });
      const output = result.content[0]!.text;

      expect(output).toContain('**Block Chance:** 25');
    });
  });

  describe('gem item', () => {
    const gemText = `Item Class: Skill Gems
Rarity: Gem
Rolling Slam
--------
Level: 15
--------
Mana Cost: 20
Attack Speed: 80% of base
--------
Slam the ground, creating a wave that rolls forward`;

    it('parses gem rarity', async () => {
      const result = await handler({ text: gemText });

      expect(result.content[0]!.text).toContain('**Gem Skill Gems**');
      expect(result.content[0]!.text).toContain('Rolling Slam');
    });
  });

  describe('unique item with flavor text', () => {
    const uniqueWithFlavorText = `Item Class: Belts
Rarity: Unique
Headhunter
Leather Belt
--------
Requires Level 40
--------
Item Level: 75
--------
+55 to maximum Life
+40 to Strength
When you Kill a Rare monster, you gain its Modifiers for 20 seconds
--------
"A hunter is never alone."`;

    it('parses flavor text', async () => {
      const result = await handler({ text: uniqueWithFlavorText });

      expect(result.content[0]!.text).toContain('### Flavor Text');
      expect(result.content[0]!.text).toContain('A hunter is never alone.');
    });
  });

  describe('language detection across all supported languages', () => {
    it.each([
      { code: 'en', keyword: 'Item Class:' },
      { code: 'ru', keyword: 'Класс предмета:' },
      { code: 'ko', keyword: '아이템 종류:' },
      { code: 'zh-TW', keyword: '物品種類:' },
      { code: 'de', keyword: 'Gegenstandsklasse:' },
      { code: 'fr', keyword: "Classe d'objet:" },
      { code: 'ja', keyword: 'アイテムクラス:' },
      { code: 'es', keyword: 'Clase de objeto:' },
      { code: 'pt', keyword: 'Classe do Item:' },
      { code: 'th', keyword: 'ประเภทไอเท็ม:' },
    ])('detects $code from item text', async ({ code, keyword }) => {
      const text = `${keyword} TestClass
--------
Some content`;

      const result = await handler({ text });

      expect(result.content[0]!.text).toContain(`*Detected language: ${code}*`);
    });
  });

  describe('edge cases', () => {
    it('returns error for empty input', async () => {
      const result = await handler({ text: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('too short');
    });

    it('returns error for short input', async () => {
      const result = await handler({ text: 'abc' });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('too short');
    });

    it('returns error for input without section delimiters', async () => {
      const result = await handler({
        text: 'Item Class: Wands\nRarity: Rare\nSome Wand Name',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('no section delimiters');
    });

    it('handles minimal valid input', async () => {
      const minimalText = `Item Class: Test
Rarity: Normal
Base Item
--------
Item Level: 1`;

      const result = await handler({ text: minimalText });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('## Base Item');
      expect(result.content[0]!.text).toContain('**Item Level:** 1');
    });

    it('handles item with only header section', async () => {
      const headerOnlyText = `Item Class: Currency
Rarity: Currency
Orb of Transmutation
--------
Upgrades a normal item to magic`;

      const result = await handler({ text: headerOnlyText });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Orb of Transmutation');
    });
  });

  describe('mod type categorization', () => {
    it('parses multiple implicit mods', async () => {
      const text = `Item Class: Rings
Rarity: Rare
Dragon Coil
Amethyst Ring
--------
+15% to Chaos Resistance (implicit)
+5 to all Attributes (implicit)
--------
Item Level: 50
--------
+30 to Strength`;

      const result = await handler({ text });

      const output = result.content[0]!.text;
      expect(output).toContain('**Implicit:**');
      expect(output).toContain('+15% to Chaos Resistance');
      expect(output).toContain('+5 to all Attributes');
    });

    it('separates enchant mods', async () => {
      const text = `Item Class: Helmets
Rarity: Rare
Dragon Crown
Great Helmet
--------
Item Level: 75
--------
40% increased Herald of Ice Damage (enchant)
--------
+50 to maximum Life`;

      const result = await handler({ text });

      expect(result.content[0]!.text).toContain('**Enchant:**');
      expect(result.content[0]!.text).toContain('40% increased Herald of Ice Damage');
    });

    it('separates crafted mods', async () => {
      const text = `Item Class: Wands
Rarity: Rare
Beast Bite
Iron Wand
--------
Item Level: 65
--------
+20 to Intelligence (crafted)
--------
+30% to Spell Damage`;

      const result = await handler({ text });

      expect(result.content[0]!.text).toContain('**Crafted:**');
      expect(result.content[0]!.text).toContain('+20 to Intelligence');
    });
  });

  describe('Magic item parsing', () => {
    const russianMagicFocusText = `Класс предмета: Фокусы
Редкость: Волшебный
Рунический фокус
--------
Энергетический щит: 25
--------
Требуется: Уровень 10
--------
Уровень предмета: 12
--------
+15% к урону от огня`;

    it('parses magic item with combined name as base type', async () => {
      const result = await handler({ text: russianMagicFocusText });

      expect(result.content[0]!.text).toContain('## Рунический фокус');
      expect(result.content[0]!.text).toContain('**Magic Фокусы**');
    });

    it('detects Russian language for magic item', async () => {
      const result = await handler({ text: russianMagicFocusText });

      expect(result.content[0]!.text).toContain('*Detected language: ru*');
    });
  });

  describe('Russian full energy shield form', () => {
    it('parses Энергетический щит (full Russian form)', async () => {
      const text = `Класс предмета: Нагрудники
Редкость: Редкий
Драконья оболочка
Пластинки
--------
Энергетический щит: 147 (augmented)
--------
Уровень предмета: 50`;

      const result = await handler({ text });

      expect(result.content[0]!.text).toContain('**Energy Shield:** 147 (augmented)');
    });
  });

  describe('Reload time parsing', () => {
    const crossbowText = `Item Class: Crossbows
Rarity: Rare
Dragon Striker
Heavy Crossbow
--------
Physical Damage: 45-89
Critical Strike Chance: 5.00%
Attacks per Second: 1.20
Reload Time: 0.79 (augmented)
--------
Requires Level 40, 80 Dex
--------
Item Level: 45
--------
+25% to Physical Damage`;

    it('parses reload time stat', async () => {
      const result = await handler({ text: crossbowText });

      expect(result.content[0]!.text).toContain('**Reload Time:** 0.79s (augmented)');
    });

    it('includes reload time in offense section', async () => {
      const result = await handler({ text: crossbowText });

      expect(result.content[0]!.text).toContain('### Offense');
      expect(result.content[0]!.text).toContain('**Physical Damage:**');
      expect(result.content[0]!.text).toContain('**Reload Time:**');
    });
  });

  describe('Requirements with Russian abbreviations', () => {
    it('parses Инт (Russian abbreviated intelligence)', async () => {
      const text = `Класс предмета: Жезлы
Редкость: Редкий
Тестовый жезл
Увядший жезл
--------
Требуется: Уровень 41, 55 (augmented) Инт
--------
Уровень предмета: 41`;

      const result = await handler({ text });

      expect(result.content[0]!.text).toContain('**Level:** 41');
      expect(result.content[0]!.text).toContain('**Intelligence:** 55');
    });

    it('parses (unmet) requirement marker', async () => {
      const text = `Item Class: Swords
Rarity: Rare
Dragon Blade
Bastard Sword
--------
Requires Level 30, 50 (unmet) Str
--------
Item Level: 30
--------
+20 to Physical Damage`;

      const result = await handler({ text });

      expect(result.content[0]!.text).toContain('**Strength:** 50 (augmented)');
    });
  });

  describe('Flavor text with guillemets', () => {
    it('parses Russian flavor text with « » quotes', async () => {
      const text = `Item Class: Crossbows
Rarity: Unique
Драконий удар
Тяжёлый арбалет
--------
Requires Level 40
--------
Item Level: 75
--------
+50% to Physical Damage
--------
«У ворот его встретили ревущие трубы»
--------
Corrupted`;

      const result = await handler({ text });

      expect(result.content[0]!.text).toContain('### Flavor Text');
      expect(result.content[0]!.text).toContain('У ворот его встретили ревущие трубы');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Item Type-Specific Parsing Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Shield Block Chance stats', () => {
    const shieldText = `Item Class: Shields
Rarity: Rare
Kraken Ward
Lacquered Buckler
--------
Block Chance: 24%
Evasion Rating: 120
--------
Requirements:
Level: 45
Dex: 60
--------
Item Level: 50
--------
+35 to Evasion Rating
+15% to Fire Resistance`;

    it('parses Block Chance as defense stat not explicit mod', async () => {
      const result = await handler({ text: shieldText });

      expect(result.content[0]!.text).toContain('### Defenses');
      expect(result.content[0]!.text).toContain('**Block Chance:** 24%');
    });

    it('parses Evasion as defense stat', async () => {
      const result = await handler({ text: shieldText });

      expect(result.content[0]!.text).toContain('**Evasion:** 120');
    });

    it('does not include Block Chance in explicit mods', async () => {
      const result = await handler({ text: shieldText });
      const lines = result.content[0]!.text.split('\n');
      const explicitSection = lines
        .slice(lines.findIndex((l) => l.includes('**Explicit:**')))
        .join('\n');

      expect(explicitSection).not.toContain('Block Chance');
    });
  });

  describe('Weapon type line filter', () => {
    const focusText = `Item Class: Foci
Rarity: Rare
Onslaught Ward
Crystal Focus
--------
Focus
--------
Requirements:
Level: 42
Int: 95
--------
Item Level: 45
--------
+50 to maximum Energy Shield
+20% to Cold Resistance`;

    it('does not parse single-word Focus as explicit mod', async () => {
      const result = await handler({ text: focusText });
      const lines = result.content[0]!.text.split('\n');
      const explicitSection = lines
        .slice(lines.findIndex((l) => l.includes('**Explicit:**')))
        .join('\n');

      expect(explicitSection).not.toContain('- Focus');
    });

    it('still parses actual explicit mods', async () => {
      const result = await handler({ text: focusText });

      expect(result.content[0]!.text).toContain('+50 to maximum Energy Shield');
      expect(result.content[0]!.text).toContain('+20% to Cold Resistance');
    });
  });

  describe('Flask base properties', () => {
    const flaskText = `Item Class: Life Flasks
Rarity: Magic
Grand Life Flask of Staunching
--------
Recovers 750 Life over 4.00 Seconds
Consumes 15 of 45 Charges on use
Currently has 45 Charges
--------
Item Level: 60
--------
Immunity to Bleeding for 5 seconds upon use
+25% increased Amount Recovered`;

    it('parses flask recovery as Flask Properties', async () => {
      const result = await handler({ text: flaskText });

      expect(result.content[0]!.text).toContain('### Flask Properties');
      expect(result.content[0]!.text).toContain('Recovers 750 Life over 4.00 Seconds');
    });

    it('parses flask charges as Flask Properties', async () => {
      const result = await handler({ text: flaskText });

      expect(result.content[0]!.text).toContain('Consumes 15 of 45 Charges on use');
      expect(result.content[0]!.text).toContain('Currently has 45 Charges');
    });

    it('does not include flask properties in explicit mods', async () => {
      const result = await handler({ text: flaskText });
      const content = result.content[0]!.text;
      const explicitIdx = content.indexOf('**Explicit:**');

      if (explicitIdx !== -1) {
        const explicitSection = content.slice(explicitIdx);
        expect(explicitSection).not.toContain('Recovers 750 Life');
        expect(explicitSection).not.toContain('Consumes 15');
      }
    });
  });

  describe('Gem tags and metadata', () => {
    const gemText = `Item Class: Skill Gems
Rarity: Gem
Essence Drain
--------
Chaos, Spell, Projectile, Duration
Level: 11
Mana Cost: 22
Cast Time: 1.36 sec
--------
Item Level: 60
--------
Deals chaos damage to enemies`;

    it('parses gem info section', async () => {
      const result = await handler({ text: gemText });

      expect(result.content[0]!.text).toContain('### Gem Info');
    });

    it('parses gem tags', async () => {
      const result = await handler({ text: gemText });

      expect(result.content[0]!.text).toContain('**Tags:** Chaos, Spell, Projectile, Duration');
    });

    it('parses gem level', async () => {
      const result = await handler({ text: gemText });

      expect(result.content[0]!.text).toContain('**Level:** 11');
    });

    it('parses gem mana cost', async () => {
      const result = await handler({ text: gemText });

      expect(result.content[0]!.text).toContain('**Mana Cost:** 22');
    });

    it('parses gem cast time', async () => {
      const result = await handler({ text: gemText });

      expect(result.content[0]!.text).toContain('**Cast Time:** 1.36 sec');
    });

    it('does not include gem metadata in explicit mods', async () => {
      const result = await handler({ text: gemText });
      const content = result.content[0]!.text;
      const explicitIdx = content.indexOf('**Explicit:**');

      if (explicitIdx !== -1) {
        const explicitSection = content.slice(explicitIdx);
        expect(explicitSection).not.toContain('Chaos, Spell, Projectile');
        expect(explicitSection).not.toContain('Level: 11');
        expect(explicitSection).not.toContain('Mana Cost: 22');
      }
    });
  });

  describe('Rune socketable effects', () => {
    const runeText = `Item Class: Socketable
Rarity: Normal
Iron Rune
--------
Socketed in Weapon: 15% increased Spell Damage
Socketed in Armour: +30 to maximum Energy Shield
--------
Right click this item then left click a socket in another item to apply it.`;

    it('parses rune effects section', async () => {
      const result = await handler({ text: runeText });

      expect(result.content[0]!.text).toContain('### Rune Effects');
    });

    it('parses Socketed in Weapon effect', async () => {
      const result = await handler({ text: runeText });

      expect(result.content[0]!.text).toContain('Socketed in Weapon: 15% increased Spell Damage');
    });

    it('parses Socketed in Armour effect', async () => {
      const result = await handler({ text: runeText });

      expect(result.content[0]!.text).toContain('Socketed in Armour: +30 to maximum Energy Shield');
    });

    it('does not include rune effects in explicit mods', async () => {
      const result = await handler({ text: runeText });
      const content = result.content[0]!.text;
      const explicitIdx = content.indexOf('**Explicit:**');

      if (explicitIdx !== -1) {
        const explicitSection = content.slice(explicitIdx);
        expect(explicitSection).not.toContain('Socketed in Weapon');
        expect(explicitSection).not.toContain('Socketed in Armour');
      }
    });

    it('filters out usage instruction line', async () => {
      const result = await handler({ text: runeText });
      const content = result.content[0]!.text;

      // Usage instruction should not appear in mods
      expect(content).not.toContain('- Right click this item');
    });
  });

  describe('Charm base properties', () => {
    const charmText = `Item Class: Charms
Rarity: Magic
Ruby Charm of Dousing
--------
Lasts 4.00 Seconds
Limit: 3
--------
Item Level: 50
--------
+10% to Fire Resistance
Immunity to Ignite during Effect`;

    it('parses Charm Properties section', async () => {
      const result = await handler({ text: charmText });

      expect(result.content[0]!.text).toContain('### Charm Properties');
    });

    it('parses charm duration', async () => {
      const result = await handler({ text: charmText });

      expect(result.content[0]!.text).toContain('Lasts 4.00 Seconds');
    });

    it('parses charm limit', async () => {
      const result = await handler({ text: charmText });

      expect(result.content[0]!.text).toContain('Limit: 3');
    });

    it('does not include charm properties in explicit mods', async () => {
      const result = await handler({ text: charmText });
      const content = result.content[0]!.text;
      const explicitIdx = content.indexOf('**Explicit:**');

      if (explicitIdx !== -1) {
        const explicitSection = content.slice(explicitIdx);
        expect(explicitSection).not.toContain('Lasts 4.00 Seconds');
        expect(explicitSection).not.toContain('Limit: 3');
      }
    });
  });

  describe('Waystone Area Level and Map properties', () => {
    const waystoneText = `Item Class: Waystones
Rarity: Normal
Waystone (Tier 5)
--------
Area Level: 70
--------
Item Level: 70
--------
Map
--------
Travel to this Map by using it in a Map Device.`;

    it('parses Map Properties section', async () => {
      const result = await handler({ text: waystoneText });

      expect(result.content[0]!.text).toContain('### Map Properties');
    });

    it('parses Area Level', async () => {
      const result = await handler({ text: waystoneText });

      expect(result.content[0]!.text).toContain('**Area Level:** 70');
    });

    it('extracts Tier from base type', async () => {
      const result = await handler({ text: waystoneText });

      expect(result.content[0]!.text).toContain('**Map Tier:** 5');
    });

    it('does not include Area Level in explicit mods', async () => {
      const result = await handler({ text: waystoneText });
      const content = result.content[0]!.text;
      const explicitIdx = content.indexOf('**Explicit:**');

      if (explicitIdx !== -1) {
        const explicitSection = content.slice(explicitIdx);
        expect(explicitSection).not.toContain('Area Level');
      }
    });

    it('filters out single-word Map line', async () => {
      const result = await handler({ text: waystoneText });
      const content = result.content[0]!.text;

      // Check that "Map" as a single line is not in explicit mods
      const lines = content.split('\n');
      const explicitMods = lines.filter((l) => l.startsWith('- '));
      expect(explicitMods.some((m) => m.trim() === '- Map')).toBe(false);
    });

    it('filters out usage instruction', async () => {
      const result = await handler({ text: waystoneText });
      const content = result.content[0]!.text;

      expect(content).not.toContain('- Travel to this Map');
    });
  });

  describe('Unique item flavour text detection', () => {
    const uniqueText = `Item Class: Body Armours
Rarity: Unique
Cloak of Flames
Simple Robe
--------
Energy Shield: 30
--------
Requirements:
Level: 10
--------
Item Level: 20
--------
+15% to Fire Resistance
+30 to maximum Mana
--------
"The Queen's rage burns eternal."`;

    it('detects quoted flavour text for Unique items', async () => {
      const result = await handler({ text: uniqueText });

      expect(result.content[0]!.text).toContain('### Flavor Text');
      expect(result.content[0]!.text).toContain("The Queen's rage burns eternal.");
    });

    it('does not include flavour text in explicit mods list', async () => {
      const result = await handler({ text: uniqueText });
      const content = result.content[0]!.text;
      const lines = content.split('\n');

      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));
      if (explicitIdx !== -1) {
        const explicitMods: string[] = [];
        for (let i = explicitIdx + 1; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.startsWith('- ')) {
            explicitMods.push(line);
          } else if (line.startsWith('**') || line.startsWith('###')) {
            break;
          }
        }
        expect(explicitMods.some((m) => m.includes("Queen's rage"))).toBe(false);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Language & Localization Edge Cases
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Portuguese Engastes sockets variant', () => {
    const portugueseItem = `Classe de Item: Armaduras de Corpo
Raridade: Raro
Veste Nova
Armadura Simples
--------
Armadura: 120
--------
Requisitos:
Nível: 45
--------
Engastes: S S
--------
Nível do Item: 50
--------
+30 à Vida Máxima`;

    it('parses Portuguese sockets with Engastes keyword', async () => {
      const result = await handler({ text: portugueseItem });

      expect(result.content[0]!.text).toContain('### Sockets');
      expect(result.content[0]!.text).toContain('S S');
    });

    it('detects Portuguese language', async () => {
      const result = await handler({ text: portugueseItem });

      expect(result.content[0]!.text).toContain('*Detected language: pt*');
    });
  });

  describe('Chinese Traditional full-width colon normalization', () => {
    // Note: Chinese game client uses full-width colon (：) followed by space
    const chineseItem = `物品種類： 胸甲
稀有度： 稀有
新防具
簡易法袍
--------
能量護盾: 50
--------
需求:
等級: 40
--------
物品等級： 45
--------
+20 至最大魔力`;

    it('parses Chinese header with full-width colon', async () => {
      const result = await handler({ text: chineseItem });

      expect(result.content[0]!.text).toContain('## 新防具');
      expect(result.content[0]!.text).toContain('簡易法袍');
    });

    it('extracts item class correctly despite full-width colon', async () => {
      const result = await handler({ text: chineseItem });

      expect(result.content[0]!.text).toContain('**Rare 胸甲**');
    });

    it('detects Chinese Traditional language', async () => {
      const result = await handler({ text: chineseItem });

      expect(result.content[0]!.text).toContain('*Detected language: zh-TW*');
    });
  });

  describe('Socketable item effects parsing', () => {
    const socketableRune = `Item Class: Socketable
Rarity: Currency
Stone Rune
--------
Weapons: 26% increased Spell Damage
Armour: +17% to Quality of Socketed Skill Gems
--------
Place into an item socket to apply.`;

    it('parses socketable effects as dedicated section', async () => {
      const result = await handler({ text: socketableRune });

      expect(result.content[0]!.text).toContain('### Socketable Effects');
      expect(result.content[0]!.text).toContain('Weapons: 26% increased Spell Damage');
      expect(result.content[0]!.text).toContain('Armour: +17% to Quality of Socketed Skill Gems');
    });

    it('does not parse Armour: line as defense stat', async () => {
      const result = await handler({ text: socketableRune });
      const content = result.content[0]!.text;

      // Should NOT have a Defense section with Armour parsed as stat
      const defenseSection = content.includes('### Defense');
      if (defenseSection) {
        expect(content).not.toMatch(/\*\*Armour:\*\*\s*17/);
      }
    });

    it('filters socketable effects from explicit mods', async () => {
      const result = await handler({ text: socketableRune });
      const content = result.content[0]!.text;
      const lines = content.split('\n');

      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));
      if (explicitIdx !== -1) {
        const explicitMods: string[] = [];
        for (let i = explicitIdx + 1; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.startsWith('- ')) {
            explicitMods.push(line);
          } else if (line.startsWith('**') || line.startsWith('###')) {
            break;
          }
        }
        expect(explicitMods.some((m) => m.includes('26% increased Spell'))).toBe(false);
      }
    });
  });

  describe('Modifier header line filtering', () => {
    const itemWithHeaders = `Item Class: Rings
Rarity: Rare
Storm Loop
Ruby Ring
--------
Requirements:
Level: 50
--------
Item Level: 55
--------
{ Implicit Modifier — Elemental }
+25% to Fire Resistance
--------
{ Prefix Modifier — Defense }
+50 to maximum Life
{ Suffix Modifier — Attack }
Adds 5 to 10 Fire Damage to Attacks`;

    it('filters modifier header lines from mods', async () => {
      const result = await handler({ text: itemWithHeaders });
      const content = result.content[0]!.text;

      expect(content).not.toContain('{ Implicit Modifier');
      expect(content).not.toContain('{ Prefix Modifier');
      expect(content).not.toContain('{ Suffix Modifier');
    });

    it('still parses actual modifier lines', async () => {
      const result = await handler({ text: itemWithHeaders });
      const content = result.content[0]!.text;

      expect(content).toContain('+25% to Fire Resistance');
      expect(content).toContain('+50 to maximum Life');
      expect(content).toContain('Adds 5 to 10 Fire Damage');
    });
  });

  describe('Jewel Limited to parsing', () => {
    const jewelWithLimit = `Item Class: Jewels
Rarity: Rare
Grim Sphere
Emerald
--------
Limited to: 2
--------
Item Level: 60
--------
+15% to Chaos Resistance
+30 to maximum Life`;

    it('parses Limited to as item metadata', async () => {
      const result = await handler({ text: jewelWithLimit });
      const content = result.content[0]!.text;

      expect(content).toContain('**Limit:** 2');
    });

    it('does not include Limited to in explicit mods', async () => {
      const result = await handler({ text: jewelWithLimit });
      const content = result.content[0]!.text;
      const lines = content.split('\n');

      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));
      if (explicitIdx !== -1) {
        const explicitMods: string[] = [];
        for (let i = explicitIdx + 1; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.startsWith('- ')) {
            explicitMods.push(line);
          } else if (line.startsWith('**') || line.startsWith('###')) {
            break;
          }
        }
        expect(explicitMods.some((m) => m.includes('Limited to'))).toBe(false);
      }
    });
  });

  describe('Uncut gem Tier filtering', () => {
    const uncutGem = `Item Class: Uncut Skill Gems
Rarity: Currency
Uncut Skill Gem
--------
Tier: 4
--------
Item Level: 65
--------
Right click this item to create a Skill Gem by selecting one from a list.`;

    it('filters Tier line from explicit mods', async () => {
      const result = await handler({ text: uncutGem });
      const content = result.content[0]!.text;
      const lines = content.split('\n');

      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));
      if (explicitIdx !== -1) {
        const explicitMods: string[] = [];
        for (let i = explicitIdx + 1; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.startsWith('- ')) {
            explicitMods.push(line);
          } else if (line.startsWith('**') || line.startsWith('###')) {
            break;
          }
        }
        expect(explicitMods.some((m) => m.includes('Tier:'))).toBe(false);
      }
    });

    it('extracts Tier value into Base section', async () => {
      const result = await handler({ text: uncutGem });
      const output = result.content[0]!.text;

      expect(output).toContain('**Tier:** 4');
    });
  });

  describe('Uncut Support Gem tier extraction', () => {
    const uncutSupport = `Item Class: Uncut Support Gems
Rarity: Currency
Uncut Support Gem
--------
Tier: 7
--------
Item Level: 52
--------
Right click this item to create a Support Gem by selecting one from a list.`;

    it('extracts Tier value', async () => {
      const result = await handler({ text: uncutSupport });
      const output = result.content[0]!.text;

      expect(output).toContain('**Tier:** 7');
    });

    it('filters Tier from explicit mods', async () => {
      const result = await handler({ text: uncutSupport });
      const content = result.content[0]!.text;
      const lines = content.split('\n');

      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));
      if (explicitIdx !== -1) {
        const explicitMods: string[] = [];
        for (let i = explicitIdx + 1; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.startsWith('- ')) {
            explicitMods.push(line);
          } else if (line.startsWith('**') || line.startsWith('###')) {
            break;
          }
        }
        expect(explicitMods.some((m) => m.includes('Tier:'))).toBe(false);
      }
    });
  });

  describe('Expedition Logbook Area Level parsing', () => {
    const logbookItem = `Item Class: Logbook
Rarity: Normal
Kalguuran Expedition Logbook
--------
Area Level: 72
--------
Item Level: 72
--------
Contains an Expedition encounter.`;

    it('parses Logbook as map item with Area Level', async () => {
      const result = await handler({ text: logbookItem });
      const content = result.content[0]!.text;

      expect(content).toContain('### Map Properties');
      expect(content).toContain('**Area Level:** 72');
    });
  });

  describe('Russian gem mana cost variant', () => {
    const russianGem = `Класс предмета: Камни умений
Редкость: Камень
Огненный шар
--------
Уровень: 20
Расход маны: 35
--------
Требуется: Уровень 70, 150 Инт
--------
Призывает огненный шар, взрывающийся при попадании.`;

    it('parses Russian mana cost (Расход маны)', async () => {
      const result = await handler({ text: russianGem });
      const content = result.content[0]!.text;

      expect(content).toContain('### Gem Info');
      expect(content).toContain('**Mana Cost:** 35');
    });
  });

  describe('Gem critical hit chance and effectiveness', () => {
    const gemWithCrit = `Item Class: Skill Gems
Rarity: Gem
Fireball
--------
Level: 20
Mana Cost: 25
Critical Hit Chance: 6.5%
Damage Effectiveness: 240%
Cast Time: 0.75 sec
--------
Requirements: Level 70, 150 Int
--------
Fires a ball of flame that explodes on impact.`;

    it('parses gem Critical Hit Chance', async () => {
      const result = await handler({ text: gemWithCrit });
      const content = result.content[0]!.text;

      expect(content).toContain('**Critical Hit Chance:** 6.5%');
    });

    it('parses gem Damage Effectiveness', async () => {
      const result = await handler({ text: gemWithCrit });
      const content = result.content[0]!.text;

      expect(content).toContain('**Damage Effectiveness:** 240%');
    });

    it('does not include crit chance in explicit mods', async () => {
      const result = await handler({ text: gemWithCrit });
      const content = result.content[0]!.text;
      const lines = content.split('\n');

      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));
      if (explicitIdx !== -1) {
        const explicitMods: string[] = [];
        for (let i = explicitIdx + 1; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.startsWith('- ')) {
            explicitMods.push(line);
          } else if (line.startsWith('**') || line.startsWith('###')) {
            break;
          }
        }
        expect(explicitMods.some((m) => m.includes('Critical Hit Chance'))).toBe(false);
        expect(explicitMods.some((m) => m.includes('Damage Effectiveness'))).toBe(false);
      }
    });
  });

  describe('Localized modifier tags', () => {
    it('classifies Russian (руна) tag as Rune', async () => {
      const text = `Класс предмета: Нательные доспехи
Редкость: Редкий
Кокон скорби
Облачение Кет
--------
Энергетический щит: 147
--------
Уровень предмета: 35
--------
58% увеличение энергетического щита (руна)
--------
+42 к максимуму энергетического щита`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('**Rune:**');
      expect(output).toContain('58% увеличение энергетического щита');
      expect(output).not.toContain('(руна)');
    });

    it('classifies Russian (неявный) tag as Implicit', async () => {
      const text = `Класс предмета: Кольца
Редкость: Редкий
Мрачная хватка
Аметистовое кольцо
--------
Уровень предмета: 44
--------
+8% к сопротивлению хаосу (неявный)
--------
+23% к сопротивлению огню`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('**Implicit:**');
      expect(output).toContain('+8% к сопротивлению хаосу');
      expect(output).not.toContain('(неявный)');
    });

    it('classifies Russian (создано) tag as Crafted', async () => {
      const text = `Класс предмета: Кольца
Редкость: Редкий
Кольцо дракона
Рубиновое кольцо
--------
Уровень предмета: 50
--------
+15 к интеллекту (создано)
--------
+30 к максимуму здоровья`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('**Crafted:**');
      expect(output).toContain('+15 к интеллекту');
      expect(output).not.toContain('(создано)');
    });
  });

  describe('Korean item parsing', () => {
    const koreanArmorText = `아이템 종류: 갑옷
희귀도: 레어
번식 포장
케스 의복
--------
에너지 보호막: 147
--------
요구사항:
레벨: 35
지능: 94
--------
홈: S S
--------
아이템 레벨: 35
--------
에너지 보호막 58% 증가 (룬)
--------
최대 에너지 보호막 +42
에너지 보호막 33% 증가
지능 +18`;

    it('parses all modifiers without loss', async () => {
      const result = await handler({ text: koreanArmorText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Rune:**');
      expect(output).toContain('에너지 보호막 58% 증가');
      expect(output).toContain('**Explicit:**');
      expect(output).toContain('최대 에너지 보호막 +42');
      expect(output).toContain('에너지 보호막 33% 증가');
      expect(output).toContain('지능 +18');
    });

    it('parses Energy Shield as defense stat', async () => {
      const result = await handler({ text: koreanArmorText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Energy Shield:** 147');
    });

    it('parses requirements correctly', async () => {
      const result = await handler({ text: koreanArmorText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Level:** 35');
      expect(output).toMatch(/Intelligence.*94/);
    });
  });

  describe('Thai item parsing', () => {
    const thaiArmorText = `ประเภทไอเท็ม: เกราะกาย
ความหายาก: หายาก
เสื้อรังไหม
เสื้อคลุมเคธ
--------
โล่พลังงาน: 147
--------
ข้อกำหนด:
เลเวล: 35
ปัญญา: 94
--------
ช่องเจียระไน: S S
--------
เลเวลไอเท็ม: 35
--------
โล่พลังงานสูงสุด +42
โล่พลังงานเพิ่มขึ้น 33%
ปัญญา +18`;

    it('parses requirements from ข้อกำหนด header', async () => {
      const result = await handler({ text: thaiArmorText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Requirements');
      expect(output).toContain('**Level:** 35');
      expect(output).toContain('**Intelligence:** 94');
    });

    it('parses Energy Shield defense stat', async () => {
      const result = await handler({ text: thaiArmorText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Energy Shield:** 147');
    });

    it('parses explicit modifiers', async () => {
      const result = await handler({ text: thaiArmorText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Explicit:**');
      expect(output).toContain('โล่พลังงานสูงสุด +42');
    });
  });

  describe('Chinese Traditional alternate ITEM_CLASS keyword', () => {
    const zhTwItem = `物品類別: 身體護甲
稀有度: 稀有
巢穴裹衣
凱斯法衣
--------
能量護盾: 100
--------
物品等級: 45
--------
+30 最大魔力`;

    it('parses item class from 物品類別 variant', async () => {
      const result = await handler({ text: zhTwItem });
      const output = result.content[0]!.text;

      expect(output).toContain('**Rare 身體護甲**');
    });

    it('detects zh-TW language', async () => {
      const result = await handler({ text: zhTwItem });
      const output = result.content[0]!.text;

      expect(output).toContain('*Detected language: zh-TW*');
    });
  });

  describe('Unique item implicit mod not misclassified as Flavor Text', () => {
    const uniqueWithSupportedBy = `Item Class: Body Armours
Rarity: Unique
Atziri's Disdain
Devotee Robe
--------
Energy Shield: 120
--------
Requires Level 45
--------
Item Level: 75
--------
Socketed Gems are Supported by Level 10 Elemental Weakness
--------
+80 to maximum Energy Shield
170% increased Energy Shield`;

    it('does not classify "Socketed Gems are Supported by" as Flavor Text', async () => {
      const result = await handler({ text: uniqueWithSupportedBy });
      const output = result.content[0]!.text;

      expect(output).not.toContain('### Flavor Text');
      expect(output).toContain('Socketed Gems are Supported by Level 10 Elemental Weakness');
    });

    it('preserves explicit mods alongside the supported-by line', async () => {
      const result = await handler({ text: uniqueWithSupportedBy });
      const output = result.content[0]!.text;

      expect(output).toContain('+80 to maximum Energy Shield');
      expect(output).toContain('170% increased Energy Shield');
    });
  });

  describe('unique item single mod not misclassified as flavor text', () => {
    const widowhailText = `Item Class: Bows
Rarity: Unique
Widowhail
Short Bow
--------
Physical Damage: 8-16
Critical Strike Chance: 5.00%
Attacks per Second: 1.50
--------
Requirements:
Level: 3
Dex: 15
--------
Sockets: S
--------
Item Level: 75
--------
Doubles the bonus from Quiver modifiers
--------
Corrupted`;

    it('classifies unquoted mod as explicit, not flavor text', async () => {
      const result = await handler({ text: widowhailText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Explicit:**');
      expect(output).toContain('Doubles the bonus from Quiver modifiers');
      expect(output).not.toContain('### Flavor Text');
    });
  });

  describe('rune section header classifies lines as rune mods', () => {
    const itemWithRuneSection = `Item Class: Helmets
Rarity: Rare
Demon Corona
Gold Circlet
--------
Energy Shield: 90
--------
Requirements:
Level: 40
Int: 60
--------
Item Level: 45
--------
36% increased Energy Shield
+50 to maximum Energy Shield
+14 to Intelligence
--------
Rune: Desert Rune (Level 1)
+10% to Fire Resistance`;

    it('classifies rune section lines as Rune mods', async () => {
      const result = await handler({ text: itemWithRuneSection });
      const output = result.content[0]!.text;

      expect(output).toContain('**Rune:**');
      expect(output).toContain('+10% to Fire Resistance');
    });

    it('keeps explicit mods separate', async () => {
      const result = await handler({ text: itemWithRuneSection });
      const output = result.content[0]!.text;

      expect(output).toContain('**Explicit:**');
      expect(output).toContain('36% increased Energy Shield');
      expect(output).toContain('+50 to maximum Energy Shield');
      expect(output).toContain('+14 to Intelligence');
    });

    it('handles Russian rune section header', async () => {
      const ruText = `Класс предмета: Шлемы
Редкость: Редкий
Магический обруч
Золотой обруч
--------
Энерг. щит: 90
--------
Уровень предмета: 45
--------
+50 к максимуму энергетического щита
--------
Вставленные руны:
Руна пустыни (Уровень 1)
+10% к сопротивлению огню`;

      const result = await handler({ text: ruText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Rune:**');
      expect(output).toContain('+10% к сопротивлению огню');
    });
  });

  describe('Thai alternate keywords', () => {
    const thaiAlternateText = `ประเภทไอเทม: เกราะกาย
ความหายาก: หายาก
บรูดแร็ป
เสื้อคลุมเคธ
--------
โล่พลังงาน: 147
--------
ข้อกำหนด:
เลเวล: 35
ปัญญา: 67
--------
ช่องใส่: S S
--------
เลเวลไอเทม: 35
--------
โล่พลังงานเพิ่มขึ้น 24%`;

    it('parses Item Class from alternate Thai keyword', async () => {
      const result = await handler({ text: thaiAlternateText });
      const output = result.content[0]!.text;

      expect(output).toContain('เกราะกาย');
      expect(output).toContain('*Detected language: th*');
    });

    it('parses Item Level from alternate Thai keyword', async () => {
      const result = await handler({ text: thaiAlternateText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Item Level:** 35');
    });

    it('parses Sockets from ช่องใส่ keyword', async () => {
      const result = await handler({ text: thaiAlternateText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Sockets');
      expect(output).toContain('S S');
    });
  });

  describe('Japanese Intelligence requirement', () => {
    const japaneseText = `アイテムクラス: 胴体防具
レアリティ: レア
テスト防具
ケスローブ
--------
エナジーシールド: 147
--------
要求:
レベル: 35
知性: 67
--------
アイテムレベル: 35
--------
エナジーシールド +42`;

    it('parses 知性 as Intelligence', async () => {
      const result = await handler({ text: japaneseText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Intelligence:** 67');
    });
  });

  describe('Spirit gem reservation', () => {
    const spiritGemText = `Item Class: Spirit Gems
Rarity: Gem
Withering Presence
--------
Spell, Aura, Duration, Chaos, Area
Level: 10
Reservation: 30 Spirit
--------
Requirements: Level 30, 50 Int
--------
Applies a chaos damage aura`;

    it('parses Reservation in Gem Info', async () => {
      const result = await handler({ text: spiritGemText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Gem Info');
      expect(output).toContain('**Reservation:** 30 Spirit');
    });
  });

  describe('gem description and experience', () => {
    const gemWithDescAndExp = `Item Class: Skill Gems
Rarity: Gem
Chaos Bolt
--------
Chaos, Spell, Projectile
Level: 10
Mana Cost: 15
Cast Time: 0.80 sec
--------
Fires a projectile that applies a Chaos Damage over Time debuff
Deals 260.6 base Chaos Damage per second
--------
Experience: 125000/250000`;

    it('classifies skill effect text as Description', async () => {
      const result = await handler({ text: gemWithDescAndExp });
      const output = result.content[0]!.text;

      expect(output).toContain('### Description');
      expect(output).toContain('Fires a projectile that applies a Chaos Damage over Time debuff');
      expect(output).toContain('Deals 260.6 base Chaos Damage per second');
    });

    it('parses Experience in Gem Info', async () => {
      const result = await handler({ text: gemWithDescAndExp });
      const output = result.content[0]!.text;

      expect(output).toContain('**Experience:** 125000/250000');
    });

    it('does not include description or experience in explicit mods', async () => {
      const result = await handler({ text: gemWithDescAndExp });
      const output = result.content[0]!.text;
      const explicitIdx = output.indexOf('**Explicit:**');

      expect(explicitIdx).toBe(-1);
    });
  });

  describe('socketable item Level parsed as base property', () => {
    const socketableText = `Item Class: Socketable
Rarity: Normal
Iron Rune
--------
Socketed in Weapon: 15% increased Spell Damage
Socketed in Armour: +30 to maximum Energy Shield
--------
Level: 1`;

    it('parses Level as item level', async () => {
      const result = await handler({ text: socketableText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Item Level:** 1');
    });

    it('does not include Level in explicit mods', async () => {
      const result = await handler({ text: socketableText });
      const output = result.content[0]!.text;
      const explicitIdx = output.indexOf('**Explicit:**');

      expect(explicitIdx).toBe(-1);
    });
  });

  describe('waystone map properties', () => {
    const waystoneWithProps = `Item Class: Waystones
Rarity: Rare
Precinct
Waystone (Tier 10)
--------
Map Tier: 10
Item Quantity: +65%
Item Rarity: +30%
Monster Pack Size: +20%
--------
Item Level: 75
--------
Monsters deal 110% extra Damage as Fire
Area contains two additional Bosses`;

    it('parses Map Tier', async () => {
      const result = await handler({ text: waystoneWithProps });
      const output = result.content[0]!.text;

      expect(output).toContain('**Map Tier:** 10');
    });

    it('parses Item Quantity', async () => {
      const result = await handler({ text: waystoneWithProps });
      const output = result.content[0]!.text;

      expect(output).toContain('**Item Quantity:** +65%');
    });

    it('parses Item Rarity', async () => {
      const result = await handler({ text: waystoneWithProps });
      const output = result.content[0]!.text;

      expect(output).toContain('**Item Rarity:** +30%');
    });

    it('parses Monster Pack Size', async () => {
      const result = await handler({ text: waystoneWithProps });
      const output = result.content[0]!.text;

      expect(output).toContain('**Monster Pack Size:** +20%');
    });

    it('does not include map properties in explicit mods', async () => {
      const result = await handler({ text: waystoneWithProps });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('Map Tier');
        expect(explicitSection).not.toContain('Item Quantity');
        expect(explicitSection).not.toContain('Monster Pack Size');
      }
    });
  });

  describe('waystone with Waystone Tier label', () => {
    const waystoneWithTierLabel = `Item Class: Waystones
Rarity: Rare
Precinct
Waystone (Tier 7)
--------
Waystone Tier: 7
Item Quantity: +40%
--------
Item Level: 72
--------
Monsters deal 90% extra Damage as Cold`;

    it('parses Waystone Tier label', async () => {
      const result = await handler({ text: waystoneWithTierLabel });
      const output = result.content[0]!.text;

      expect(output).toContain('**Map Tier:** 7');
    });

    it('parses Item Quantity alongside Waystone Tier', async () => {
      const result = await handler({ text: waystoneWithTierLabel });
      const output = result.content[0]!.text;

      expect(output).toContain('**Item Quantity:** +40%');
    });
  });

  describe('charm charge consumption', () => {
    const charmWithCharges = `Item Class: Charms
Rarity: Magic
Ruby Charm of Dousing
--------
Lasts 4.00 Seconds
Limit: 3
Consumes 20 of 60 Charges on use
--------
Item Level: 50
--------
+10% to Fire Resistance`;

    it('parses Consumes line in Charm Properties', async () => {
      const result = await handler({ text: charmWithCharges });
      const output = result.content[0]!.text;

      expect(output).toContain('### Charm Properties');
      expect(output).toContain('Consumes 20 of 60 Charges on use');
    });

    it('includes duration and limit alongside charges', async () => {
      const result = await handler({ text: charmWithCharges });
      const output = result.content[0]!.text;

      expect(output).toContain('Lasts 4.00 Seconds');
      expect(output).toContain('Limit: 3');
    });
  });

  describe('jewel without base type has no trailing dash', () => {
    const jewelText = `Item Class: Jewels
Rarity: Rare
Chaotic Sapphire
--------
Limited to: 2
--------
Item Level: 60
--------
+15% to Chaos Resistance
+30 to maximum Life`;

    it('renders header without trailing dash or base type', async () => {
      const result = await handler({ text: jewelText });
      const output = result.content[0]!.text;

      expect(output).toContain('## Chaotic Sapphire');
      expect(output).toContain('**Rare Jewels**');
      expect(output).not.toContain('**Rare Jewels** —');
    });
  });

  describe('Russian implicit tag (неотъемлемый)', () => {
    const russianRingText = `Класс предмета: Кольца
Редкость: Редкий
Зловещий захват
Кольцо с аметистом
--------
Требуется: Уровень 26
--------
Уровень предмета: 34
--------
+8% к сопротивлению хаосу (неотъемлемый)
--------
+27 к меткости
+39 к уклонению`;

    it('classifies (неотъемлемый) as implicit', async () => {
      const result = await handler({ text: russianRingText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Implicit:**');
      expect(output).toContain('+8% к сопротивлению хаосу');
      expect(output).not.toContain('(неотъемлемый)');
    });

    it('does not put implicit mod in explicit section', async () => {
      const result = await handler({ text: russianRingText });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('сопротивлению хаосу');
      }
    });
  });

  describe('Russian wand implicit granted skill with (неотъемлемый)', () => {
    const russianWandImplicitText = `Класс предмета: Жезлы
Редкость: Редкий
Чумное проклятие
Увядший жезл
--------
Уровень предмета: 41
--------
Предоставляет умение Снаряд хаоса 11-го уровня (неотъемлемый)
--------
91% увеличение урона от чар`;

    it('classifies granted skill line with (неотъемлемый) as implicit', async () => {
      const result = await handler({ text: russianWandImplicitText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Implicit:**');
      expect(output).toContain('Предоставляет умение Снаряд хаоса 11-го уровня');
      expect(output).not.toContain('(неотъемлемый)');
    });
  });

  describe('Korean implicit tag (고정)', () => {
    const koreanRingText = `아이템 종류: 반지
희귀도: 레어
어둠의 고리
자수정 반지
--------
아이템 레벨: 34
--------
+8% 모든 원소 저항 (고정)
--------
+27 명중
+39 회피`;

    it('classifies (고정) as implicit', async () => {
      const result = await handler({ text: koreanRingText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Implicit:**');
      expect(output).toContain('+8% 모든 원소 저항');
      expect(output).not.toContain('(고정)');
    });
  });

  describe('Russian Ячейки sockets keyword', () => {
    const russianSocketsText = `Класс предмета: Жезлы
Редкость: Редкий
Чумное проклятие
Увядший жезл
--------
Ячейки: S S
--------
Уровень предмета: 41
--------
+10 к интеллекту`;

    it('parses Ячейки as sockets', async () => {
      const result = await handler({ text: russianSocketsText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Sockets');
      expect(output).toContain('S S');
    });

    it('does not include Ячейки in explicit mods', async () => {
      const result = await handler({ text: russianSocketsText });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('Ячейки');
      }
    });
  });

  describe('German Fassung (singular) sockets keyword', () => {
    const germanSocketsText = `Gegenstandsklasse: Körperrüstungen
Seltenheit: Selten
Testpanzer
Plattenrüstung
--------
Rüstung: 200
--------
Fassung: S
--------
Gegenstandsstufe: 50
--------
+30 zu maximalem Leben`;

    it('parses Fassung (singular) as sockets', async () => {
      const result = await handler({ text: germanSocketsText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Sockets');
      expect(output).toContain('S');
    });

    it('does not include Fassung in explicit mods', async () => {
      const result = await handler({ text: germanSocketsText });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('Fassung');
      }
    });
  });

  describe('Russian full-form crit chance', () => {
    const russianWandStatsText = `Класс предмета: Жезлы
Редкость: Редкий
Чумное проклятие
Увядший жезл
--------
Физический урон: 12-22
Шанс критического удара: 7.00%
Атак в секунду: 1.50
--------
Уровень предмета: 41
--------
+10 к интеллекту`;

    it('parses Шанс критического удара as crit chance', async () => {
      const result = await handler({ text: russianWandStatsText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Offense');
      expect(output).toContain('**Critical Chance:** 7%');
    });

    it('parses all weapon stats together', async () => {
      const result = await handler({ text: russianWandStatsText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Physical Damage:** 12-22');
      expect(output).toContain('**Attacks per Second:** 1.5');
    });

    it('does not leak crit chance to explicit mods', async () => {
      const result = await handler({ text: russianWandStatsText });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('критического удара');
      }
    });
  });

  describe('Elemental damage in weapon header', () => {
    const crossbowText = `Item Class: Crossbows
Rarity: Rare
Storm Striker
Arbalest
--------
Physical Damage: 10-20
Lightning Damage: 10-273
Critical Strike Chance: 5.00%
Attacks per Second: 1.20
Reload Time: 0.79
--------
Requires Level 40, 80 Dex
--------
Item Level: 45
--------
+25% to Physical Damage`;

    it('parses Lightning Damage as elemental', async () => {
      const result = await handler({ text: crossbowText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Offense');
      expect(output).toContain('**Lightning Damage:** 10-273');
    });

    it('parses physical damage alongside elemental', async () => {
      const result = await handler({ text: crossbowText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Physical Damage:** 10-20');
    });

    it('does not leak elemental damage to explicit mods', async () => {
      const result = await handler({ text: crossbowText });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('Lightning Damage');
      }
    });
  });

  describe('Multiple elemental damage types', () => {
    const multiElementText = `Item Class: Wands
Rarity: Rare
Flame Spark
Bone Wand
--------
Fire Damage: 15-30
Cold Damage: 5-12
Critical Strike Chance: 6.00%
Attacks per Second: 1.40
--------
Item Level: 55
--------
+20% to Spell Damage`;

    it('parses multiple elemental damage types', async () => {
      const result = await handler({ text: multiElementText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Fire Damage:** 15-30');
      expect(output).toContain('**Cold Damage:** 5-12');
    });
  });

  describe('Broadened modifier header filtering', () => {
    const itemWithRuneHeader = `Item Class: Rings
Rarity: Rare
Storm Loop
Ruby Ring
--------
Item Level: 55
--------
{ Rune Modifier }
+12% to Fire Resistance (rune)
--------
+50 to maximum Life`;

    it('filters { Rune Modifier } header from output', async () => {
      const result = await handler({ text: itemWithRuneHeader });
      const output = result.content[0]!.text;

      expect(output).not.toContain('{ Rune Modifier }');
      expect(output).toContain('+12% to Fire Resistance');
    });

    it('filters { Desecrated Modifier } header', async () => {
      const text = `Item Class: Body Armours
Rarity: Rare
Doom Shell
Full Plate
--------
Item Level: 80
--------
{ Desecrated Modifier — Tier 1 }
+100 to maximum Life (desecrated)
--------
+30% to Fire Resistance`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).not.toContain('{ Desecrated Modifier');
      expect(output).toContain('+100 to maximum Life');
    });

    it('filters { Crafted Modifier } header', async () => {
      const text = `Item Class: Wands
Rarity: Rare
Grim Spark
Iron Wand
--------
Item Level: 70
--------
{ Crafted Modifier }
+20 to Intelligence (crafted)
--------
+30% to Spell Damage`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).not.toContain('{ Crafted Modifier }');
      expect(output).toContain('+20 to Intelligence');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Regression Tests: Localization & Parsing Fixes
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Russian skill gem with Самоцвет rarity', () => {
    const russianGemText = `Класс предмета: Камни умений
Редкость: Самоцвет
Похищение сущности
--------
Хаос, Снаряд, Чары, Длительность
Уровень: 11
Расход маны: 22
Время сотворения: 1,36 сек
Шанс критического удара: 9,66%
--------
Выпускает снаряд, который накладывает на первого поражённого противника эффект урона хаосом в секунду.
--------
Наносит от 29 до 44 Урона хаосом
Базовая длительность: 3,80 сек`;

    it('detects Gem rarity from Самоцвет', async () => {
      const result = await handler({ text: russianGemText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Gem Камни умений**');
    });

    it('parses gem tags', async () => {
      const result = await handler({ text: russianGemText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Gem Info');
      expect(output).toContain('**Tags:** Хаос, Снаряд, Чары, Длительность');
    });

    it('parses gem level and mana cost', async () => {
      const result = await handler({ text: russianGemText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Level:** 11');
      expect(output).toContain('**Mana Cost:** 22');
    });

    it('parses cast time with comma decimal separator', async () => {
      const result = await handler({ text: russianGemText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Cast Time:** 1.36 sec');
    });

    it('parses crit chance with comma decimal separator', async () => {
      const result = await handler({ text: russianGemText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Critical Hit Chance:** 9.66%');
    });

    it('extracts gem description lines', async () => {
      const result = await handler({ text: russianGemText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Description');
      expect(output).toContain('Выпускает снаряд');
    });
  });

  describe('Russian modifier tags', () => {
    it.each([
      { tag: 'скрытый', expectedType: 'Implicit' },
      { tag: 'расколотый', expectedType: 'Fractured' },
      { tag: 'осквернённый', expectedType: 'Desecrated' },
      { tag: 'мастерский', expectedType: 'Crafted' },
    ])('classifies ($tag) as $expectedType', async ({ tag, expectedType }) => {
      const text = `Класс предмета: Кольца
Редкость: Редкий
Тестовое кольцо
Рубиновое кольцо
--------
Уровень предмета: 50
--------
+25% к сопротивлению огню (${tag})
--------
+30 к максимуму здоровья`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain(`**${expectedType}:**`);
      expect(output).toContain('+25% к сопротивлению огню');
      expect(output).not.toContain(`(${tag})`);
    });
  });

  describe('Non-English fractured and desecrated tags', () => {
    it.each([
      { lang: 'de', tag: 'frakturiert', keyword: 'Gegenstandsklasse' },
      { lang: 'fr', tag: 'fracturé', keyword: "Classe d'objet" },
      { lang: 'ko', tag: '분열', keyword: '아이템 종류' },
      { lang: 'ja', tag: 'フラクチャー', keyword: 'アイテムクラス' },
    ])('classifies ($tag) as Fractured for $lang', async ({ tag, keyword }) => {
      const text = `${keyword}: Rings
--------
+25 to Life (${tag})`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('**Fractured:**');
      expect(output).not.toContain(`(${tag})`);
    });

    it.each([
      { lang: 'de', tag: 'entweiht', keyword: 'Gegenstandsklasse' },
      { lang: 'fr', tag: 'profané', keyword: "Classe d'objet" },
      { lang: 'ko', tag: '모독', keyword: '아이템 종류' },
      { lang: 'ja', tag: '冒涜', keyword: 'アイテムクラス' },
    ])('classifies ($tag) as Desecrated for $lang', async ({ tag, keyword }) => {
      const text = `${keyword}: Rings
--------
+50 to Life (${tag})`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('**Desecrated:**');
      expect(output).not.toContain(`(${tag})`);
    });
  });

  describe('Russian flask parsing', () => {
    const russianFlaskText = `Класс предмета: Фляги жизни
Редкость: Волшебный
Большая фляга жизни противодействия кровотечению
--------
Восстанавливает 785 жизни за 4,00 сек
Расходует 20 из 60 зарядов при использовании
Текущее количество зарядов: 60
--------
Уровень предмета: 30
--------
Иммунитет к кровотечению на 5 сек`;

    it('detects Magic rarity for Russian flask', async () => {
      const result = await handler({ text: russianFlaskText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Magic');
    });

    it('extracts flask recovery as Flask Properties', async () => {
      const result = await handler({ text: russianFlaskText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Flask Properties');
      expect(output).toContain('Восстанавливает 785');
    });

    it('extracts flask charges', async () => {
      const result = await handler({ text: russianFlaskText });
      const output = result.content[0]!.text;

      expect(output).toContain('Расходует 20');
      expect(output).toContain('Текущее количество зарядов: 60');
    });
  });

  describe('Japanese granted skills', () => {
    const japaneseWandText = `アイテムクラス: ワンド
レアリティ: レア
テストワンド
枯れたワンド
--------
アイテムレベル: 41
--------
付与スキル: カオスボルト (レベル 11)
--------
呪文ダメージ 91% 増加`;

    it('extracts granted skill from 付与スキル keyword', async () => {
      const result = await handler({ text: japaneseWandText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Granted Skills');
      expect(output).toContain('カオスボルト (レベル 11)');
    });

    it('does not leak granted skill into explicit mods', async () => {
      const result = await handler({ text: japaneseWandText });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitMods: string[] = [];
        for (let i = explicitIdx + 1; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.startsWith('- ')) {
            explicitMods.push(line);
          } else if (line.startsWith('**') || line.startsWith('###')) {
            break;
          }
        }
        expect(explicitMods.some((m) => m.includes('カオスボルト'))).toBe(false);
      }
    });
  });

  describe('Thai granted skills and rune tag', () => {
    it('extracts granted skill from ได้รับสกิล keyword', async () => {
      const text = `ประเภทไอเท็ม: คทา
ความหายาก: หายาก
คทาทดสอบ
คทามืด
--------
เลเวลไอเท็ม: 41
--------
ได้รับสกิล: ลูกธนูเคออส (เลเวล 11)
--------
ความเสียหายเวท 91% เพิ่มขึ้น`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('### Granted Skills');
      expect(output).toContain('ลูกธนูเคออส (เลเวล 11)');
    });

    it('classifies Thai (อักขระ) tag as Rune', async () => {
      const text = `ประเภทไอเท็ม: คทา
ความหายาก: หายาก
คทาทดสอบ
คทามืด
--------
เลเวลไอเท็ม: 35
--------
ความเสียหายเวทเพิ่มขึ้น 36% (อักขระ)
--------
โล่พลังงานสูงสุด +42`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('**Rune:**');
      expect(output).toContain('ความเสียหายเวทเพิ่มขึ้น 36%');
      expect(output).not.toContain('(อักขระ)');
    });
  });

  describe('Portuguese item class and level with lowercase variant', () => {
    const portugueseStavesText = `Classe do item: Cajados
Raridade: Raro
Maldição da Praga
Cajado Seco
--------
Nível do item: 30
--------
+25% ao Dano de Magia`;

    it('parses item class from lowercase Classe do item', async () => {
      const result = await handler({ text: portugueseStavesText });
      const output = result.content[0]!.text;

      expect(output).toContain('Cajados');
      expect(output).toContain('**Rare');
    });

    it('parses item level from lowercase Nível do item', async () => {
      const result = await handler({ text: portugueseStavesText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Item Level:** 30');
    });

    it('detects Portuguese language', async () => {
      const result = await handler({ text: portugueseStavesText });
      const output = result.content[0]!.text;

      expect(output).toContain('*Detected language: pt*');
    });
  });

  describe('French granted skill prefix cleanup', () => {
    it('extracts skill name without prefix leak', async () => {
      const text = `Classe d'objet: Baguettes
Rareté: Rare
Test Baguette
Baguette Flétrie
--------
Niveau de l'objet: 41
--------
Octroie la compétence: Projectile du Chaos (Niveau 11)
--------
91% d'augmentation des dégâts des sorts`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('### Granted Skills');
      expect(output).toContain('Projectile du Chaos (Niveau 11)');
      expect(output).not.toContain('la compétence:');
    });
  });

  describe('Critical Hit Chance with augmented flag', () => {
    const spearText = `Item Class: Spears
Rarity: Rare
Dragon Lance
Iron Spear
--------
Physical Damage: 25-45
Critical Hit Chance: 8.70% (augmented)
Attacks per Second: 1.30
--------
Requires Level 30, 50 Str
--------
Item Level: 35
--------
+20% to Physical Damage`;

    it('parses Critical Hit Chance with full precision', async () => {
      const result = await handler({ text: spearText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Critical Chance:** 8.7% (augmented)');
    });

    it('preserves augmented flag on crit chance', async () => {
      const result = await handler({ text: spearText });
      const output = result.content[0]!.text;
      const critLine = output.split('\n').find((l) => l.includes('Critical Chance'));

      expect(critLine).toContain('(augmented)');
    });
  });

  describe('Elemental Damage with type tags', () => {
    it('parses multi-element damage with type annotations', async () => {
      const text = `Item Class: Spears
Rarity: Rare
Storm Lance
Iron Spear
--------
Physical Damage: 25-45
Elemental Damage: 39-62 (fire), 9-14 (cold)
Critical Hit Chance: 5.00%
Attacks per Second: 1.30
--------
Item Level: 35
--------
+20% to Physical Damage`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('**fire:** 39-62');
      expect(output).toContain('**cold:** 9-14');
    });

    it('parses single-element Elemental Damage', async () => {
      const text = `Item Class: Wands
Rarity: Rare
Fire Wand
Bone Wand
--------
Elemental Damage: 15-30 (fire)
Critical Hit Chance: 6.00%
Attacks per Second: 1.40
--------
Item Level: 55
--------
+20% to Spell Damage`;

      const result = await handler({ text });
      const output = result.content[0]!.text;

      expect(output).toContain('**fire:** 15-30');
    });
  });

  describe('Russian mana flask', () => {
    const manaFlaskText = `Класс предмета: Фляги маны
Редкость: Обычный
Большая фляга маны
--------
Восстанавливает 200 маны за 4,00 сек
Расходует 15 из 45 зарядов при использовании
Текущее количество зарядов: 45
--------
Уровень предмета: 25`;

    it('detects as flask and extracts properties', async () => {
      const result = await handler({ text: manaFlaskText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Flask Properties');
      expect(output).toContain('Восстанавливает 200');
    });
  });

  describe('Thai alternate keyword ชนิดไอเท็ม for Item Class', () => {
    const thaiItemText = `ชนิดไอเท็ม: เกราะ
ความหายาก: แรร์
ผ้าห่อโรคระบาด
ชุดคลุมเคธ
--------
โล่พลังงาน: 147
--------
ข้อกำหนด:
เลเวล: 35
ปัญญา: 67
--------
ช่องเสียบ: ช ช
--------
เลเวลไอเท็ม: 35
--------
โล่พลังงานสูงสุด +30
ต้านทานไฟ +14%
ต้านทานน้ำแข็ง +10%`;

    it('detects Thai language from ชนิดไอเท็ม keyword', async () => {
      const result = await handler({ text: thaiItemText });
      const output = result.content[0]!.text;

      expect(output).toContain('*Detected language: th*');
    });

    it('parses Item Class from ชนิดไอเท็ม', async () => {
      const result = await handler({ text: thaiItemText });
      const output = result.content[0]!.text;

      expect(output).toContain('เกราะ');
    });

    it('parses sockets from ช่องเสียบ keyword', async () => {
      const result = await handler({ text: thaiItemText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Sockets');
      expect(output).toContain('ช ช');
    });

    it('does not classify sockets line as explicit mod', async () => {
      const result = await handler({ text: thaiItemText });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('ช่องเสียบ');
      }
    });

    it('parses Energy Shield defense stat', async () => {
      const result = await handler({ text: thaiItemText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Energy Shield:** 147');
    });

    it('parses Item Level', async () => {
      const result = await handler({ text: thaiItemText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Item Level:** 35');
    });

    it('parses requirements', async () => {
      const result = await handler({ text: thaiItemText });
      const output = result.content[0]!.text;

      expect(output).toContain('### Requirements');
      expect(output).toContain('**Level:** 35');
    });

    it('parses explicit modifiers', async () => {
      const result = await handler({ text: thaiItemText });
      const output = result.content[0]!.text;

      expect(output).toContain('**Explicit:**');
      expect(output).toContain('ต้านทานไฟ +14%');
      expect(output).toContain('ต้านทานน้ำแข็ง +10%');
    });
  });

  describe('standalone rune name in section (real clipboard format)', () => {
    const itemWithSocketedRune = `Item Class: Wands
Rarity: Rare
Blight Ruin
Withered Wand
--------
Quality: +20% (augmented)
--------
Requires: Level 41, 55 (augmented) Int
--------
Sockets: S
--------
Item Level: 41
--------
25% increased Spell Damage (rune)
--------
Iron Rune
--------
Grants Skill: Chaos Projectile Level 11
--------
91% increased Spell Damage
+84 to maximum Mana`;

    it('does not classify standalone rune name as explicit mod', async () => {
      const result = await handler({ text: itemWithSocketedRune });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('Iron Rune');
      }
    });

    it('assigns rune name to the socket', async () => {
      const result = await handler({ text: itemWithSocketedRune });
      const output = result.content[0]!.text;

      expect(output).toContain('S(Iron Rune)');
    });

    it('still parses rune-tagged mods correctly', async () => {
      const result = await handler({ text: itemWithSocketedRune });
      const output = result.content[0]!.text;

      expect(output).toContain('**Rune:**');
      expect(output).toContain('25% increased Spell Damage');
    });

    it('still parses explicit mods', async () => {
      const result = await handler({ text: itemWithSocketedRune });
      const output = result.content[0]!.text;

      expect(output).toContain('91% increased Spell Damage');
      expect(output).toContain('+84 to maximum Mana');
    });

    it('still extracts granted skills', async () => {
      const result = await handler({ text: itemWithSocketedRune });
      const output = result.content[0]!.text;

      expect(output).toContain('### Granted Skills');
      expect(output).toContain('Chaos Projectile Level 11');
    });
  });

  describe('standalone Soul Core name in section', () => {
    const itemWithSoulCore = `Item Class: Body Armours
Rarity: Rare
Dread Shell
Keth Raiment
--------
Energy Shield: 147
--------
Sockets: S S
--------
Item Level: 50
--------
Soul Core of Tacati
--------
+42 to maximum Energy Shield
33% increased Energy Shield`;

    it('does not classify Soul Core name as explicit mod', async () => {
      const result = await handler({ text: itemWithSoulCore });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('Soul Core of Tacati');
      }
    });

    it('assigns soul core name to a socket', async () => {
      const result = await handler({ text: itemWithSoulCore });
      const output = result.content[0]!.text;

      expect(output).toContain('S(Soul Core of Tacati)');
    });
  });

  describe('standalone Russian rune name in section', () => {
    const russianItemWithRune = `Класс предмета: Жезлы
Редкость: Редкий
Чумное проклятие
Увядший жезл
--------
Гнезда: S
--------
Уровень предмета: 41
--------
25% увеличение урона от чар (руна)
--------
Железная руна
--------
91% увеличение урона от чар`;

    it('does not classify Железная руна as explicit mod', async () => {
      const result = await handler({ text: russianItemWithRune });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines.slice(explicitIdx, explicitIdx + 10).join('\n');
        expect(explicitSection).not.toContain('Железная руна');
      }
    });

    it('assigns rune name to the socket', async () => {
      const result = await handler({ text: russianItemWithRune });
      const output = result.content[0]!.text;

      expect(output).toContain('S(Железная руна)');
    });
  });

  describe('enrichment', () => {
    beforeEach(() => {
      vi.mocked(lookupBaseItem).mockReset();
      vi.mocked(matchAllModTiers).mockReset().mockResolvedValue([]);
      vi.mocked(lookupUniquePriceFromScout).mockReset();
    });

    function setupBaseItemMock(overrides: Record<string, unknown> = {}) {
      vi.mocked(lookupBaseItem).mockResolvedValue({
        name: 'Expert Vaal Regalia',
        itemClass: 'Body Armour',
        tags: ['int_armour', 'body_armour', 'armour', 'default'],
        baseEs: 150,
        baseArmour: null,
        baseEvasion: null,
        basePhysDamageMin: null,
        basePhysDamageMax: null,
        baseCritChance: null,
        baseAttackTime: null,
        reqLevel: 52,
        reqStr: null,
        reqDex: null,
        reqInt: 45,
        ...overrides,
      });
    }

    function setupModTiersMock(
      tiers: Array<{
        modText: string;
        value: number;
        tier: number;
        totalTiers: number;
        range: [number, number];
        prefixSuffix: 'prefix' | 'suffix';
      }>,
    ) {
      vi.mocked(matchAllModTiers).mockResolvedValue(
        tiers.map((t) => ({
          ...t,
          bestTierAtIlvl: t.tier,
          modGroup: 'TestGroup',
          affixName: 'Test',
        })),
      );
    }

    function setupScoutMock(chaos: number, volume: number) {
      vi.mocked(lookupUniquePriceFromScout).mockResolvedValue({ chaos, volume });
    }

    const rareBodyArmour = `Item Class: Body Armours
Rarity: Rare
Storm Shell
Expert Vaal Regalia
--------
Energy Shield: 200 (augmented)
--------
Requires Level 52, 78 Str, 45 Int
--------
Sockets: S S
--------
Item Level: 75
--------
+50 to maximum Energy Shield
15% increased Evasion Rating
+30 to Intelligence`;

    const uniqueRing = `Item Class: Rings
Rarity: Unique
Circle of Guilt
Sapphire Ring
--------
Requires Level 45
--------
Item Level: 68
--------
+25 to Intelligence
10% increased maximum Energy Shield`;

    const currencyItem = `Item Class: Stackable Currency
Rarity: Currency
Exalted Orb
--------
Stack Size: 3/10
--------
Adds a random modifier to a rare item`;

    const uniqueBodyArmour = `Item Class: Body Armours
Rarity: Unique
Kaom's Heart
Glorious Plate
--------
Armour: 800 (augmented)
--------
Requires Level 60, 100 Str
--------
Item Level: 80
--------
+500 to maximum Life`;

    const magicGloves = `Item Class: Gloves
Rarity: Magic
Ample Iron Gauntlets of Skill
Iron Gauntlets
--------
Armour: 50
--------
Item Level: 30
--------
+20 to maximum Life
5% increased Attack Speed`;

    describe('handler integration', () => {
      it('appends enrichment section when enrich=true on equipment', async () => {
        setupBaseItemMock();

        const result = await handler({ text: rareBodyArmour, enrich: true });

        expect(result.content[0]!.text).toContain('### Enrichment');
        expect(result.content[0]!.text).toContain('**Base:**');
      });

      it('skips enrichment when enrich is not provided', async () => {
        const result = await handler({ text: rareBodyArmour });

        expect(result.content[0]!.text).not.toContain('### Enrichment');
        expect(lookupBaseItem).not.toHaveBeenCalled();
      });

      it('skips enrichment when enrich=false', async () => {
        const result = await handler({ text: rareBodyArmour, enrich: false });

        expect(result.content[0]!.text).not.toContain('### Enrichment');
        expect(lookupBaseItem).not.toHaveBeenCalled();
      });

      it('does not break parsing when RePoE fails', async () => {
        vi.mocked(lookupBaseItem).mockRejectedValue(new Error('Network error'));

        const result = await handler({ text: rareBodyArmour, enrich: true });

        expect(result.isError).toBeUndefined();
        expect(result.content[0]!.text).toContain('## Storm Shell');
      });

      it('does not break parsing when poe2scout fails', async () => {
        vi.mocked(lookupUniquePriceFromScout).mockRejectedValue(new Error('Network error'));

        const result = await handler({ text: uniqueRing, enrich: true });

        expect(result.isError).toBeUndefined();
        expect(result.content[0]!.text).not.toContain('**Price:**');
      });

      it('passes league to poe2scout lookup', async () => {
        setupScoutMock(150, 25);

        await handler({ text: uniqueRing, enrich: true, league: 'Test League' });

        expect(lookupUniquePriceFromScout).toHaveBeenCalledWith(
          'Circle of Guilt',
          'Rings',
          'Test League',
        );
      });

      it('uses default league when not specified', async () => {
        setupScoutMock(150, 25);

        await handler({ text: uniqueRing, enrich: true });

        expect(lookupUniquePriceFromScout).toHaveBeenCalledWith(
          'Circle of Guilt',
          'Rings',
          'Forbidden Rites',
        );
      });
    });

    describe('equipment classification', () => {
      it('calls lookupBaseItem for equipment item class', async () => {
        setupBaseItemMock();

        await handler({ text: rareBodyArmour, enrich: true });

        expect(lookupBaseItem).toHaveBeenCalledWith('Expert Vaal Regalia');
      });

      it('does not call lookupBaseItem for currency', async () => {
        await handler({ text: currencyItem, enrich: true });

        expect(lookupBaseItem).not.toHaveBeenCalled();
      });

      it('calls lookupBaseItem for accessories (rings are enrichable)', async () => {
        setupBaseItemMock({ name: 'Sapphire Ring', itemClass: 'Ring', tags: ['ring', 'default'] });
        setupScoutMock(100, 10);

        await handler({ text: uniqueRing, enrich: true });

        expect(lookupBaseItem).toHaveBeenCalled();
      });
    });

    describe('poe2scout category mapping', () => {
      it('calls poe2scout for unique body armour', async () => {
        setupBaseItemMock({ name: 'Glorious Plate', baseArmour: 500, baseEs: null });
        setupScoutMock(500, 50);

        await handler({ text: uniqueBodyArmour, enrich: true });

        expect(lookupUniquePriceFromScout).toHaveBeenCalledWith(
          "Kaom's Heart",
          'Body Armours',
          expect.any(String),
        );
      });

      it('calls poe2scout for unique ring', async () => {
        setupScoutMock(150, 25);

        await handler({ text: uniqueRing, enrich: true });

        expect(lookupUniquePriceFromScout).toHaveBeenCalledWith(
          'Circle of Guilt',
          'Rings',
          expect.any(String),
        );
      });

      it('does not call poe2scout for non-unique items', async () => {
        setupBaseItemMock();

        await handler({ text: rareBodyArmour, enrich: true });

        expect(lookupUniquePriceFromScout).not.toHaveBeenCalled();
      });
    });

    describe('base stats extraction (RePoE)', () => {
      it('renders energy shield and requirements', async () => {
        setupBaseItemMock();

        const result = await handler({ text: rareBodyArmour, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('**Base:** Expert Vaal Regalia');
        expect(output).toContain('Base ES: 150');
        expect(output).toContain('Lv52');
        expect(output).toContain('Int 45');
      });

      it('renders armour and strength requirement', async () => {
        setupBaseItemMock({
          name: 'Iron Gauntlets',
          itemClass: 'Gloves',
          tags: ['str_armour', 'gloves', 'armour', 'default'],
          baseEs: null,
          baseArmour: 100,
          reqLevel: 30,
          reqStr: 50,
          reqInt: null,
        });

        const result = await handler({ text: magicGloves, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('Base Armour: 100');
        expect(output).toContain('Str 50');
      });

      it('renders weapon stats', async () => {
        setupBaseItemMock({
          name: 'Great Mallet',
          itemClass: 'Two Hand Mace',
          tags: ['mace', 'twohand', 'default'],
          baseEs: null,
          baseArmour: null,
          basePhysDamageMin: 30,
          basePhysDamageMax: 60,
          baseCritChance: 5.5,
          baseAttackTime: 1.4,
          reqLevel: 40,
          reqStr: 80,
          reqInt: null,
        });
        const weaponText = `Item Class: Two Hand Maces
Rarity: Rare
Beast Bane
Great Mallet
--------
Physical Damage: 45-89 (augmented)
--------
Requires Level 35, 95 Str
--------
Item Level: 38
--------
+15 to Strength`;

        const result = await handler({ text: weaponText, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('Base Phys: 30-60');
        expect(output).toContain('Base Crit: 5.5%');
        expect(output).toContain('Base APS: 1.4');
      });

      it('omits base section when base item not found', async () => {
        vi.mocked(lookupBaseItem).mockResolvedValue(null);

        const result = await handler({ text: rareBodyArmour, enrich: true });

        expect(result.content[0]!.text).not.toContain('**Base:**');
      });
    });

    describe('mod tier matching (RePoE)', () => {
      it('renders mod tier table when tiers match', async () => {
        setupBaseItemMock();
        setupModTiersMock([
          {
            modText: '+50 to maximum Energy Shield',
            value: 50,
            tier: 1,
            totalTiers: 8,
            range: [40, 55],
            prefixSuffix: 'prefix',
          },
          {
            modText: '15% increased Evasion Rating',
            value: 15,
            tier: 1,
            totalTiers: 5,
            range: [15, 20],
            prefixSuffix: 'suffix',
          },
          {
            modText: '+30 to Intelligence',
            value: 30,
            tier: 1,
            totalTiers: 6,
            range: [25, 35],
            prefixSuffix: 'suffix',
          },
        ]);

        const result = await handler({ text: rareBodyArmour, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('**Mod Tiers (Item Level 75):**');
        expect(output).toContain('+50 to maximum Energy Shield');
        expect(output).toContain('T1/8');
      });

      it('identifies prefix and suffix correctly', async () => {
        setupBaseItemMock();
        setupModTiersMock([
          {
            modText: '+50 to maximum Energy Shield',
            value: 50,
            tier: 1,
            totalTiers: 8,
            range: [40, 55],
            prefixSuffix: 'prefix',
          },
          {
            modText: '15% increased Evasion Rating',
            value: 15,
            tier: 1,
            totalTiers: 5,
            range: [15, 20],
            prefixSuffix: 'suffix',
          },
        ]);

        const result = await handler({ text: rareBodyArmour, enrich: true });
        const output = result.content[0]!.text;
        const tableRows = output
          .split('\n')
          .filter((l: string) => l.startsWith('|') && !l.startsWith('|--'));

        const esRow = tableRows.find((l: string) => l.includes('Energy Shield'));
        const evasRow = tableRows.find((l: string) => l.includes('Evasion'));

        expect(esRow).toContain('| P |');
        expect(evasRow).toContain('| S |');
      });

      it('omits mod tier table when no mods match', async () => {
        setupBaseItemMock();
        vi.mocked(matchAllModTiers).mockResolvedValue([]);

        const result = await handler({ text: rareBodyArmour, enrich: true });

        expect(result.content[0]!.text).not.toContain('**Mod Tiers');
      });
    });

    describe('open prefix/suffix slots', () => {
      it('shows open slots for rare items', async () => {
        setupBaseItemMock();
        setupModTiersMock([
          {
            modText: '+50 to maximum Energy Shield',
            value: 50,
            tier: 1,
            totalTiers: 8,
            range: [40, 55],
            prefixSuffix: 'prefix',
          },
          {
            modText: '15% increased Evasion Rating',
            value: 15,
            tier: 1,
            totalTiers: 5,
            range: [15, 20],
            prefixSuffix: 'suffix',
          },
          {
            modText: '+30 to Intelligence',
            value: 30,
            tier: 1,
            totalTiers: 6,
            range: [25, 35],
            prefixSuffix: 'suffix',
          },
        ]);

        const result = await handler({ text: rareBodyArmour, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('**Open Slots:** 2 prefix, 1 suffix open');
        expect(output).toContain('3P/3S max for Rare');
      });

      it('shows open slots for magic items', async () => {
        setupBaseItemMock({
          name: 'Iron Gauntlets',
          itemClass: 'Gloves',
          tags: ['str_armour', 'gloves', 'armour', 'default'],
          baseArmour: 50,
          baseEs: null,
        });
        setupModTiersMock([
          {
            modText: '+20 to maximum Life',
            value: 20,
            tier: 1,
            totalTiers: 6,
            range: [15, 25],
            prefixSuffix: 'prefix',
          },
          {
            modText: '5% increased Attack Speed',
            value: 5,
            tier: 2,
            totalTiers: 4,
            range: [5, 8],
            prefixSuffix: 'suffix',
          },
        ]);

        const result = await handler({ text: magicGloves, enrich: true });

        expect(result.content[0]!.text).toContain('1P/1S max for Magic');
      });
    });

    describe('unique pricing', () => {
      it('renders price when poe2scout returns a match', async () => {
        setupBaseItemMock({ name: 'Sapphire Ring', itemClass: 'Ring', tags: ['ring', 'default'] });
        setupScoutMock(150, 25);

        const result = await handler({ text: uniqueRing, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('**Price:** Circle of Guilt');
        expect(output).toContain('150.0 chaos');
        expect(output).toContain('vol: 25');
      });

      it('omits price line when poe2scout returns null', async () => {
        vi.mocked(lookupUniquePriceFromScout).mockResolvedValue(null);

        const result = await handler({ text: uniqueRing, enrich: true });

        expect(result.content[0]!.text).not.toContain('**Price:**');
      });

      it('omits price line when poe2scout throws', async () => {
        vi.mocked(lookupUniquePriceFromScout).mockRejectedValue(new Error('Network error'));

        const result = await handler({ text: uniqueRing, enrich: true });

        expect(result.content[0]!.text).not.toContain('**Price:**');
      });

      it('renders both base type and pricing for unique equipment', async () => {
        setupBaseItemMock({
          name: 'Glorious Plate',
          baseEs: null,
          baseArmour: 500,
          reqLevel: 60,
          reqStr: 100,
          reqInt: null,
        });
        setupScoutMock(500, 50);

        const result = await handler({ text: uniqueBodyArmour, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('Base Armour: 500');
        expect(output).toContain("**Price:** Kaom's Heart");
        expect(output).toContain('500.0 chaos');
      });

      it('does not display price section for non-unique items', async () => {
        setupBaseItemMock();

        const result = await handler({ text: rareBodyArmour, enrich: true });

        expect(result.content[0]!.text).not.toContain('**Price:**');
      });

      it('omits price for 0-value items', async () => {
        vi.mocked(lookupUniquePriceFromScout).mockResolvedValue({ chaos: 0, volume: 0 });

        const result = await handler({ text: uniqueRing, enrich: true });

        expect(result.content[0]!.text).not.toContain('**Price:**');
      });
    });

    describe('non-enrichable items', () => {
      it('returns no enrichment section for currency', async () => {
        const result = await handler({ text: currencyItem, enrich: true });

        expect(result.content[0]!.text).not.toContain('### Enrichment');
      });
    });

    describe('RU locale enrichment with base type translation', () => {
      const russianBodyArmour = `Класс предмета: Нательные доспехи
Редкость: Редкий
Кокон скорби
Облачение Кет
--------
Энергетический щит: 147
--------
Требования:
Уровень: 35
Инт: 67
--------
Уровень предмета: 35
--------
Гнёзда: S S
--------
55% увеличение энергетического щита
+31 к максимуму энергетического щита
+14% к сопротивлению огню
12% увеличение редкости найденных предметов`;

      it('resolves English base type and includes enrichment', async () => {
        vi.mocked(resolveEnglishBaseType).mockResolvedValue('Keth_Raiment');
        setupBaseItemMock({ name: 'Keth Raiment', baseEs: 70, reqLevel: 35, reqInt: 67 });

        const result = await handler({ text: russianBodyArmour, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('### Enrichment');
        expect(output).toContain('Base ES: 70');
      });

      it('shows English base type name in header when lang != en', async () => {
        vi.mocked(resolveEnglishBaseType).mockResolvedValue('Keth_Raiment');
        setupBaseItemMock({ name: 'Keth Raiment', baseEs: 70 });

        const result = await handler({ text: russianBodyArmour, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('Облачение Кет (Keth Raiment)');
      });

      it('calls resolveEnglishBaseType for non-EN items', async () => {
        vi.mocked(resolveEnglishBaseType).mockResolvedValue('Keth_Raiment');
        setupBaseItemMock({ name: 'Keth Raiment', baseEs: 70 });

        await handler({ text: russianBodyArmour, enrich: true });

        expect(resolveEnglishBaseType).toHaveBeenCalledWith(
          'Облачение Кет',
          expect.any(String),
          'ru',
        );
      });

      it('uses resolved English name for lookupBaseItem', async () => {
        vi.mocked(resolveEnglishBaseType).mockResolvedValue('Keth_Raiment');
        setupBaseItemMock({ name: 'Keth Raiment', baseEs: 70 });

        await handler({ text: russianBodyArmour, enrich: true });

        expect(lookupBaseItem).toHaveBeenCalledWith('Keth Raiment');
      });

      it('falls back to lookupBaseItemByClass when translation and name lookup both fail', async () => {
        vi.mocked(resolveEnglishBaseType).mockResolvedValue(null);
        vi.mocked(lookupBaseItem).mockResolvedValue(null);
        vi.mocked(lookupBaseItemByClass).mockResolvedValue({
          name: 'Keth Raiment',
          itemClass: 'Body Armour',
          tags: ['int_armour', 'body_armour', 'armour', 'default'],
          baseEs: 70,
          baseArmour: null,
          baseEvasion: null,
          basePhysDamageMin: null,
          basePhysDamageMax: null,
          baseCritChance: null,
          baseAttackTime: null,
          reqLevel: 28,
          reqStr: null,
          reqDex: null,
          reqInt: 47,
        });

        const result = await handler({ text: russianBodyArmour, enrich: true });
        const output = result.content[0]!.text;

        expect(output).toContain('### Enrichment');
        expect(output).toContain('Base ES: 70');
        expect(lookupBaseItemByClass).toHaveBeenCalledWith('Body Armour', 35);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Review Bug Fix Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('TEST 1: weapon base stats not classified as explicit mods', () => {
    const wandWithBaseStats = `Item Class: Wands
Rarity: Rare
Plague Bane
Withered Wand
--------
Wand Damage: 5-14
Attack Speed: 1.50
--------
Requirements:
Level: 35
Int: 94
--------
Item Level: 42
--------
Sockets: S
--------
116% increased Spell Damage
Grants Level 11 Chaos Bolt Skill
27% increased Mana Regeneration Rate`;

    it('parses Wand Damage as offense stat, not explicit mod', async () => {
      const result = await handler({ text: wandWithBaseStats });
      const output = result.content[0]!.text;

      expect(output).toContain('### Offense');
      expect(output).toContain('**Physical Damage:** 5-14');
    });

    it('does not include Wand Damage in explicit mods', async () => {
      const result = await handler({ text: wandWithBaseStats });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l: string) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines
          .slice(explicitIdx)
          .filter((l: string) => l.startsWith('- '))
          .join('\n');
        expect(explicitSection).not.toContain('Wand Damage');
        expect(explicitSection).not.toContain('Attack Speed');
      }
    });

    it('parses Attack Speed as offense stat', async () => {
      const result = await handler({ text: wandWithBaseStats });
      const output = result.content[0]!.text;

      expect(output).toContain('### Offense');
    });

    const russianWandWithBaseStats = `Класс предмета: Жезлы
Редкость: Редкий
Чумное проклятие
Увядший жезл
--------
Жезл Урон: 5-14
Атак в секунду: 1.50
--------
Требования:
Уровень: 35
Инт: 94
--------
Уровень предмета: 42
--------
116% увеличение урона заклинаний`;

    it('parses Russian weapon damage as offense stat', async () => {
      const result = await handler({ text: russianWandWithBaseStats });
      const output = result.content[0]!.text;

      expect(output).toContain('### Offense');
      expect(output).toContain('**Physical Damage:** 5-14');
    });
  });

  describe('TEST 10: EN granted skills extraction (inline format)', () => {
    const itemWithGrantedSkill = `Item Class: Wands
Rarity: Rare
Plague Bane
Withered Wand
--------
Item Level: 42
--------
116% increased Spell Damage
Grants Level 11 Chaos Bolt Skill
27% increased Mana Regeneration Rate`;

    it('extracts granted skill from EN inline format', async () => {
      const result = await handler({ text: itemWithGrantedSkill });
      const output = result.content[0]!.text;

      expect(output).toContain('### Granted Skills');
      expect(output).toContain('Chaos Bolt');
      expect(output).toContain('Level 11');
    });

    it('removes granted skill from explicit mods list', async () => {
      const result = await handler({ text: itemWithGrantedSkill });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l: string) => l.includes('**Explicit:**'));

      if (explicitIdx !== -1) {
        const explicitSection = lines
          .slice(explicitIdx)
          .filter((l: string) => l.startsWith('- '))
          .join('\n');
        expect(explicitSection).not.toContain('Grants Level 11');
        expect(explicitSection).not.toContain('Chaos Bolt Skill');
      }
    });

    it('still parses RU granted skill format correctly', async () => {
      const russianItem = `Класс предмета: Жезлы
Редкость: Редкий
Тестовый жезл
Увядший жезл
--------
Уровень предмета: 42
--------
Дарует умение: Снаряд хаоса 11 уровня
91% увеличение урона от чар`;

      const result = await handler({ text: russianItem });
      const output = result.content[0]!.text;

      expect(output).toContain('### Granted Skills');
      expect(output).toContain('Снаряд хаоса 11 уровня');
    });
  });

  describe('Issue #4: standalone weapon skill name deduplication', () => {
    const wandWithStandaloneSkillName = `Item Class: Wands
Rarity: Rare
Plague Bane
Withered Wand
--------
Wand Damage: 5-14
Critical Hit Chance: 8.00%
Attack Speed: 1.50
--------
Item Level: 42
--------
Sockets: S
--------
Chaos Bolt
--------
116% increased Spell Damage
+10% to Chaos Damage over Time Multiplier
10% increased Cast Speed
Grants Level 11 Chaos Bolt Skill`;

    it('does not include standalone skill name as explicit mod', async () => {
      const result = await handler({ text: wandWithStandaloneSkillName });
      const output = result.content[0]!.text;
      const lines = output.split('\n');
      const explicitIdx = lines.findIndex((l: string) => l.includes('**Explicit:**'));

      expect(explicitIdx).toBeGreaterThan(-1);
      const explicitMods = lines.slice(explicitIdx + 1).filter((l: string) => l.startsWith('- '));

      const modTexts = explicitMods.map((l: string) => l.replace(/^- /, ''));
      expect(modTexts).not.toContain('Chaos Bolt');
    });

    it('still lists the granted skill in Granted Skills section', async () => {
      const result = await handler({ text: wandWithStandaloneSkillName });
      const output = result.content[0]!.text;

      expect(output).toContain('### Granted Skills');
      expect(output).toContain('Chaos Bolt (Level 11)');
    });

    it('preserves other explicit mods', async () => {
      const result = await handler({ text: wandWithStandaloneSkillName });
      const output = result.content[0]!.text;

      expect(output).toContain('116% increased Spell Damage');
      expect(output).toContain('+10% to Chaos Damage over Time Multiplier');
      expect(output).toContain('10% increased Cast Speed');
    });
  });
});
