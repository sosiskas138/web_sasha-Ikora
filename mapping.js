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
  // Поле 1: Комментарий
  COMMENTS: {
    source: 'multiple',  // Специальное значение - собираем из нескольких полей
    transform: (value, data) => {
      const comments = [];
      const agreements = data.call?.agreements || {};
      const call = data.call || {};

      // Договоренности
      if (agreements.agreements) {
        comments.push(`Договоренности: ${agreements.agreements}`);
      }

      // Факты о клиенте
      if (agreements.client_facts) {
        comments.push(`Факты о клиенте: ${agreements.client_facts}`);
      }

      // SMS текст
      if (agreements.smsText) {
        comments.push(`SMS текст: ${agreements.smsText}`);
      }

      // Длительность звонка
      if (call.duration) {
        const durationMinutes = Math.floor(call.duration / 60000);
        const durationSeconds = Math.floor((call.duration % 60000) / 1000);
        comments.push(`Длительность звонка: ${durationMinutes} мин ${durationSeconds} сек`);
      }

      // Время начала звонка
      if (call.startedAt) {
        comments.push(`Звонок начат: ${new Date(call.startedAt).toLocaleString('ru-RU')}`);
      }

      // Время окончания звонка
      if (call.endedAt) {
        comments.push(`Звонок завершен: ${new Date(call.endedAt).toLocaleString('ru-RU')}`);
      }

      // Время договоренности
      if (agreements.agreements_time) {
        comments.push(`Время договоренности: ${agreements.agreements_time}`);
      }

      // Направление лида
      if (agreements.lead_destination) {
        comments.push(`Направление лида: ${agreements.lead_destination}`);
      }

      // Статус
      if (agreements.status) {
        comments.push(`Статус: ${agreements.status}`);
      }

      // Регион (из dadataPhoneInfo)
      if (data.contact?.dadataPhoneInfo?.region) {
        comments.push(`Регион: ${data.contact.dadataPhoneInfo.region}`);
      }

      // Оператор (из dadataPhoneInfo)
      if (data.contact?.dadataPhoneInfo?.provider) {
        comments.push(`Оператор: ${data.contact.dadataPhoneInfo.provider}`);
      }

      // Часовой пояс (из dadataPhoneInfo)
      if (data.contact?.dadataPhoneInfo?.timezone) {
        comments.push(`Часовой пояс: ${data.contact.dadataPhoneInfo.timezone}`);
      }

      // Колл-лист
      if (data.callList?.name) {
        comments.push(`Колл-лист: ${data.callList.name}`);
      }

      // Теги контакта
      if (data.contact?.tags && data.contact.tags.length > 0) {
        comments.push(`Теги: ${data.contact.tags.join(', ')}`);
      }

      // Дополнительная информация
      const additionalInfo = [];
      if (data.contact?.additionalFields?.website) {
        additionalInfo.push(`Сайт: ${data.contact.additionalFields.website}`);
      }
      if (data.contact?.additionalFields?.page) {
        additionalInfo.push(`Страница: ${data.contact.additionalFields.page}`);
      }
      if (data.contact?.additionalFields?.ip) {
        additionalInfo.push(`IP: ${data.contact.additionalFields.ip}`);
      }
      if (additionalInfo.length > 0) {
        comments.push(`\nДополнительная информация:\n${additionalInfo.join('\n')}`);
      }

      // Тип звонка
      if (call.type) {
        comments.push(`Тип звонка: ${call.type === 'outgoing' ? 'Исходящий' : 'Входящий'}`);
      }

      // Статус звонка
      if (call.status) {
        comments.push(`Статус звонка: ${call.status}`);
      }

      // Причина завершения
      if (call.hangupReason) {
        comments.push(`Причина завершения: ${call.hangupReason}`);
      }

      return comments.join('\n\n');
    }
  },

  // Поле 2: Имя......
  NAME: {
    source: 'call.agreements.client_name',  // Имя клиента из договоренностей
    transform: (value) => {
      return value ? value.trim() : '';
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
  
  for (const [bitrixField, config] of Object.entries(mapping)) {
    try {
      let value;
      
      if (config.source === 'static') {
        // Статическое значение
        value = config.value;
      } else if (config.source === 'multiple') {
        // Специальная обработка для множественных источников
        value = config.transform ? config.transform(null, webhookData) : null;
      } else {
        // Получаем значение по пути
        const rawValue = getValueByPath(webhookData, config.source);
        
        // Применяем преобразование, если есть
        if (config.transform) {
          value = config.transform(rawValue, webhookData);
        } else {
          value = rawValue;
        }
      }
      
      // Добавляем поле только если значение не null/undefined
      if (value !== null && value !== undefined) {
        result[bitrixField] = value;
      }
    } catch (error) {
      console.warn(`Ошибка при обработке поля ${bitrixField}:`, error.message);
    }
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
