/**
 * МАППИНГ ДАННЫХ: Вебхук → Bitrix
 * 
 * Этот файл определяет, какие данные из вебхука попадают в какие поля Bitrix.
 * Чтобы изменить соответствие, просто поменяйте значение в поле "source" или "transform".
 * 
 * Структура:
 * - source: путь к данным в вебхуке (например, 'call.agreements.client_name')
 * - transform: функция преобразования (опционально)
 * - default: значение по умолчанию, если данных нет (опционально)
 */

/**
 * Маппинг для ЛИДОВ в Bitrix
 *
 * По просьбе: оставляем только три поля:
 * 1. "Комментарий"  → COMMENTS
 * 2. "Имя......"    → NAME
 * 3. "ТелефонН"     → PHONE
 */
const leadMapping = {
  STATUS_ID: {
    source: 'static',
    value: 'UC_E5DGC8' // ← "ЛИДЫ ИИ"
  },
  
  COMMENTS: {
    source: 'multiple',
    transform: (value, data) => {
      const facts = data.call?.agreements?.client_facts;
      return facts || null;
    }
  },

  // Поле 2: Имя......
  NAME: {
    source: 'call.agreements.client_name',  // Имя клиента из договоренностей
    transform: (value) => {
      const trimmed = value ? value.trim() : '';
      // Возвращаем null вместо пустой строки, чтобы Bitrix мог использовать значение по умолчанию
      return trimmed || null;
    }
  },

  // Поле 3: ТелефонН
  PHONE: {
    source: 'contact.phone',  // Телефон контакта
    transform: (value) => {
      const phoneFormatted = value ? value.replace(/\D/g, '') : '';
      if (!phoneFormatted) return null;

      return [{
        VALUE: phoneFormatted,
        VALUE_TYPE: 'WORK'
      }];
    }
  }
};

/**
 * Маппинг для СДЕЛОК в Bitrix
 * (можно добавить позже, если понадобится)
 */
const dealMapping = {
  // Пример структуры (раскомментируйте и настройте по необходимости):
  /*
  TITLE: {
    source: 'call.agreements.agreements',
    transform: (value) => `Сделка: ${value?.substring(0, 100)}`
  },
  */
};

/**
 * Маппинг для КОНТАКТОВ в Bitrix
 * (можно добавить позже, если понадобится)
 */
const contactMapping = {
  // Пример структуры (раскомментируйте и настройте по необходимости):
  /*
  NAME: {
    source: 'call.agreements.client_name',
    transform: (value) => value?.split(' ')[0] || ''
  },
  */
};

/**
 * Функция для получения значения из объекта по пути (например, 'contact.phone')
 */
function getValueByPath(obj, path) {
  if (!path || path === 'static' || path === 'multiple') {
    return null;
  }
  
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null;
  }, obj);
}

/**
 * Применяет маппинг к данным вебхука
 * @param {Object} webhookData - Данные из вебхука
 * @param {Object} mapping - Объект маппинга (leadMapping, dealMapping и т.д.)
 * @returns {Object} - Объект с полями для Bitrix
 */
function applyMapping(webhookData, mapping) {
  const result = {};
  const skippedFields = [];
  
  for (const [bitrixField, config] of Object.entries(mapping)) {
    try {
      let value;
      
      if (config.source === 'static') {
        // Статическое значение
        value = config.value;
        console.log(`   [MAPPING] ${bitrixField}: статическое значение = ${value}`);
      } else if (config.source === 'multiple') {
        // Специальная обработка для множественных источников
        value = config.transform ? config.transform(null, webhookData) : null;
        console.log(`   [MAPPING] ${bitrixField}: множественный источник = ${value ? '✓' : '✗'}`);
      } else {
        // Получаем значение по пути
        const rawValue = getValueByPath(webhookData, config.source);
        console.log(`   [MAPPING] ${bitrixField}: путь "${config.source}" = ${rawValue !== null ? JSON.stringify(rawValue) : 'null'}`);
        
        // Применяем преобразование, если есть
        if (config.transform) {
          value = config.transform(rawValue, webhookData);
          console.log(`   [MAPPING] ${bitrixField}: после transform = ${value !== null ? JSON.stringify(value) : 'null'}`);
        } else {
          value = rawValue;
        }
      }
      
      // Добавляем поле только если значение не null/undefined и не пустая строка
      if (value !== null && value !== undefined && value !== '') {
        // Для массивов проверяем, что они не пустые
        if (Array.isArray(value) && value.length === 0) {
          skippedFields.push(`${bitrixField} (пустой массив)`);
          continue;
        }
        result[bitrixField] = value;
        console.log(`   [MAPPING] ✓ ${bitrixField} добавлено в результат`);
      } else {
        skippedFields.push(`${bitrixField} (${value === null ? 'null' : value === undefined ? 'undefined' : 'пустая строка'})`);
        console.log(`   [MAPPING] ✗ ${bitrixField} пропущено: ${value === null ? 'null' : value === undefined ? 'undefined' : 'пустая строка'}`);
      }
    } catch (error) {
      console.warn(`   [MAPPING] ❌ Ошибка при обработке поля ${bitrixField}:`, error.message);
      skippedFields.push(`${bitrixField} (ошибка: ${error.message})`);
    }
  }
  
  if (skippedFields.length > 0) {
    console.log(`   [MAPPING] Пропущено полей: ${skippedFields.length}`, skippedFields);
  }
  
  return result;
}

module.exports = {
  leadMapping,
  dealMapping,
  contactMapping,
  applyMapping,
  getValueByPath
};
