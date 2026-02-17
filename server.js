const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { leadMapping, applyMapping } = require('./mapping');
require('dotenv').config();

const app = express();

const PORT = process.env.DOCKERPORT || process.env.PORT || 7777;

// Middleware для получения сырого тела запроса ТОЛЬКО для /webhook (нужно для проверки подписи)
// Важно: это должно быть ДО express.json(), чтобы Express не пытался парсить JSON дважды
// Используем express.text() для получения строки, как в документации
app.use('/webhook', express.text({ 
  type: 'application/json',  // Принимаем application/json
  limit: '10mb' // Лимит размера тела запроса
}));

// Middleware для парсинга JSON в других роутах (НЕ для /webhook)
// Express автоматически пропустит /webhook, т.к. тело уже обработано express.raw()
app.use(express.json({ limit: '10mb' }));

// Middleware для логирования входящих запросов
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  
  // Логируем тело запроса
  if (req.body) {
    if (typeof req.body === 'string') {
      // Для /webhook (express.text())
      console.log('Body:', req.body);
    } else if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      // Для других роутов (express.json())
      console.log('Body:', JSON.stringify(req.body, null, 2));
    }
  }
  
  next();
});

/**
 * 
 * @param {Object} payload 
 * @param {String} signature 
 * @param {String} secret 
 * @returns {Boolean}
 */
function verifyWebhookSignature(payload, signature, secret) {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(computed, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

/**
 * Функция для заполнения карточки лида в Bitrix
 * Использует маппинг из mapping.js для преобразования данных
 * @param {Object} data - Данные в формате вебхука от Sasha AI
 * @returns {Promise<Object>} - Результат создания лида в Bitrix
 */
async function createLeadInBitrix(data) {
  console.log('\n🔵 [DEBUG] Начало создания лида в Bitrix');
  console.log('📥 [DEBUG] Входные данные:', JSON.stringify(data, null, 2));
  
  const bitrixWebhookUrl = process.env.BITRIX_WEBHOOK_URL;
  
  if (!bitrixWebhookUrl) {
    console.error('❌ [DEBUG] BITRIX_WEBHOOK_URL не установлен в переменных окружения');
    throw new Error('BITRIX_WEBHOOK_URL не установлен в переменных окружения');
  }

  console.log('🔗 [DEBUG] Bitrix Webhook URL:', bitrixWebhookUrl);

  // Применяем маппинг для преобразования данных вебхука в поля Bitrix
  console.log('🔄 [DEBUG] Применение маппинга...');
  const leadFields = applyMapping(data, leadMapping);
  console.log('✅ [DEBUG] Результат маппинга:', JSON.stringify(leadFields, null, 2));
  
  // Проверяем, что есть хотя бы одно поле для создания лида
  if (!leadFields || Object.keys(leadFields).length === 0) {
    console.error('❌ [DEBUG] После маппинга не осталось ни одного поля!');
    console.error('   Входные данные:', JSON.stringify(data, null, 2));
    throw new Error('После маппинга не осталось полей для создания лида. Проверьте структуру входящих данных.');
  }
  
  // Проверяем обязательные поля для Bitrix
  const requiredFields = ['NAME', 'PHONE'];
  const missingFields = requiredFields.filter(field => !leadFields[field] || 
    (Array.isArray(leadFields[field]) && leadFields[field].length === 0) ||
    (typeof leadFields[field] === 'string' && leadFields[field].trim() === ''));
  
  if (missingFields.length > 0) {
    console.warn('⚠️  [DEBUG] Отсутствуют некоторые обязательные поля:', missingFields);
    console.warn('   Доступные поля:', Object.keys(leadFields));
  }
  
  // Формируем данные для отправки в Bitrix
  const leadData = {
    fields: leadFields
  };
  
  console.log('📤 [DEBUG] Данные для отправки в Bitrix:', JSON.stringify(leadData, null, 2));
  console.log('📊 [DEBUG] Количество полей:', Object.keys(leadFields).length);
  console.log('📋 [DEBUG] Список полей:', Object.keys(leadFields).join(', '));
  
  // Отправка запроса в Bitrix
  try {
    // Убеждаемся, что URL заканчивается на слэш
    const url = bitrixWebhookUrl.endsWith('/') 
      ? `${bitrixWebhookUrl}crm.lead.add`
      : `${bitrixWebhookUrl}/crm.lead.add`;
    
    console.log('🌐 [DEBUG] Полный URL для запроса:', url);
    console.log('📡 [DEBUG] Отправка POST запроса в Bitrix...');
    
    const response = await axios.post(
      url,
      leadData,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000, // 30 секунд таймаут
        validateStatus: function (status) {
          // Принимаем любые статусы для детальной обработки
          return status >= 200 && status < 600;
        }
      }
    );
    
    console.log('📡 [DEBUG] Запрос отправлен, получен ответ');
    console.log('   HTTP Status:', response.status);
    
    console.log('✅ [DEBUG] Ответ получен от Bitrix:');
    console.log('   Status:', response.status);
    console.log('   Response data:', JSON.stringify(response.data, null, 2));
    
    // Проверяем, что Bitrix действительно создал лид
    if (response.data.error) {
      console.error('❌ [DEBUG] Bitrix вернул ошибку:');
      console.error('   Error:', response.data.error);
      console.error('   Error description:', response.data.error_description);
      throw new Error(`Bitrix вернул ошибку: ${response.data.error} - ${response.data.error_description || ''}`);
    }
    
    if (!response.data.result) {
      console.error('❌ [DEBUG] Bitrix не вернул ID лида!');
      console.error('   Response:', JSON.stringify(response.data, null, 2));
      throw new Error('Bitrix не вернул ID созданного лида. Возможно, лид не был создан.');
    }
    
    console.log('✅ [DEBUG] Лид успешно создан в Bitrix!');
    console.log('   Lead ID:', response.data.result);
    
    return {
      success: true,
      leadId: response.data.result,
      data: response.data
    };
  } catch (error) {
    console.error('❌ [DEBUG] Ошибка при создании лида в Bitrix:');
    console.error('   Error message:', error.message);
    console.error('   Error code:', error.code);
    
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
    }
    
    if (error.request) {
      console.error('   Request was made but no response received');
      console.error('   Request config:', JSON.stringify({
        url: error.config?.url,
        method: error.config?.method,
        data: error.config?.data
      }, null, 2));
    }
    
    throw new Error(`Ошибка при создании лида в Bitrix: ${error.response?.data?.error_description || error.message}`);
  }
}

/**
 * Обработчик вебхука от Sasha AI
 */
app.post('/webhook', async (req, res) => {
  console.log('\n' + '='.repeat(80));
  console.log('🔔 [WEBHOOK] Получен новый вебхук от Sasha AI');
  console.log('='.repeat(80));
  
  const payload = req.body; // Теперь это строка благодаря express.text()
  
  console.log('📋 [WEBHOOK] Заголовки запроса:');
  console.log('   Content-Type:', req.headers['content-type']);
  console.log('   Content-Length:', req.headers['content-length']);
  
  // Проверка наличия тела запроса
  if (!payload) {
    console.error('❌ [WEBHOOK] Тело запроса пустое');
    return res.status(400).send('Тело запроса пустое');
  }
  
  console.log('📦 [WEBHOOK] Размер payload:', payload.length, 'символов');

  try {
    const data = JSON.parse(payload);
    console.log('✅ [WEBHOOK] JSON успешно распарсен');
    console.log('📊 [WEBHOOK] Структура данных:');
    console.log('   - contact:', data.contact ? '✓ присутствует' : '✗ отсутствует');
    console.log('   - call:', data.call ? '✓ присутствует' : '✗ отсутствует');
    
    // Валидация наличия данных
    if (!data || Object.keys(data).length === 0) {
      console.error('❌ [WEBHOOK] Данные не предоставлены');
      return res.status(400).json({
        success: false,
        error: 'Данные не предоставлены. Отправьте JSON в теле запроса'
      });
    }
    
    // Валидация обязательных полей
    if (!data.contact || !data.call) {
      console.error('❌ [WEBHOOK] Отсутствуют обязательные поля');
      console.error('   contact:', data.contact ? '✓' : '✗');
      console.error('   call:', data.call ? '✓' : '✗');
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: contact или call'
      });
    }
    
    // Детальная информация о данных
    console.log('📞 [WEBHOOK] Информация о контакте:');
    console.log('   Phone:', data.contact?.phone || 'не указан');
    console.log('📞 [WEBHOOK] Информация о звонке:');
    console.log('   Client name:', data.call?.agreements?.client_name || 'не указано');
    console.log('   Client facts:', data.call?.agreements?.client_facts ? '✓ присутствуют' : '✗ отсутствуют');
    
    // Создание лида в Bitrix
    console.log('🚀 [WEBHOOK] Начинаем создание лида в Bitrix...');
    const result = await createLeadInBitrix(data);
    
    console.log('✅ [WEBHOOK] Лид успешно создан!');
    console.log('   Lead ID:', result.leadId);
    console.log('='.repeat(80) + '\n');
    
    res.json({
      success: true,
      message: 'Лид успешно создан в Bitrix',
      leadId: result.leadId,
      data: result.data
    });
  } catch (error) {
    console.error('\n❌ [WEBHOOK] Ошибка при обработке запроса:');
    console.error('   Error type:', error.constructor.name);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    console.log('='.repeat(80) + '\n');
    
    res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * Тестовый endpoint: отправка лида в Bitrix вручную.
 *
 * Использование:
 * - POST /test/bitrix/lead
 * - Content-Type: application/json
 * - Body: JSON в формате вебхука Sasha AI (или частично — важны contact + call)
 *
 * Важно: endpoint не проверяет подпись и предназначен только для тестов.
 */
app.post('/test/bitrix/lead', async (req, res) => {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 [TEST] Тестовый запрос на создание лида');
  console.log('='.repeat(80));
  
  try {
    const data = req.body;
    console.log('📥 [TEST] Полученные данные:', JSON.stringify(data, null, 2));

    if (!data || typeof data !== 'object') {
      console.error('❌ [TEST] Данные не предоставлены');
      return res.status(400).json({
        success: false,
        error: 'Данные не предоставлены. Отправьте JSON в теле запроса'
      });
    }

    // Минимальная валидация как в /webhook
    if (!data.contact || !data.call) {
      console.error('❌ [TEST] Отсутствуют обязательные поля');
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: contact или call'
      });
    }

    console.log('🚀 [TEST] Начинаем создание лида в Bitrix...');
    const result = await createLeadInBitrix(data);

    console.log('✅ [TEST] Тестовый лид успешно создан!');
    console.log('   Lead ID:', result.leadId);
    console.log('='.repeat(80) + '\n');

    return res.json({
      success: true,
      message: 'Тестовый лид успешно создан в Bitrix',
      leadId: result.leadId,
      data: result.data
    });
  } catch (error) {
    console.error('\n❌ [TEST] Ошибка при тестовой отправке в Bitrix:');
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    console.log('='.repeat(80) + '\n');
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера'
    });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  
  if (!process.env.WEBHOOK_SECRET) {
    console.warn('⚠️  ВНИМАНИЕ: WEBHOOK_SECRET не установлен. Проверка подписи отключена!');
  }
  
  if (!process.env.BITRIX_WEBHOOK_URL) {
    console.warn('⚠️  ВНИМАНИЕ: BITRIX_WEBHOOK_URL не установлен. Отправка в Bitrix не будет работать!');
  }
});
