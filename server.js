const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { leadMapping, applyMapping } = require('./mapping');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3333;

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
  const bitrixWebhookUrl = process.env.BITRIX_WEBHOOK_URL;
  
  if (!bitrixWebhookUrl) {
    throw new Error('BITRIX_WEBHOOK_URL не установлен в переменных окружения');
  }

  // Применяем маппинг для преобразования данных вебхука в поля Bitrix
  const leadFields = applyMapping(data, leadMapping);
  
  // Формируем данные для отправки в Bitrix
  const leadData = {
    fields: leadFields
  };
  
  // Отправка запроса в Bitrix
  try {
    // Убеждаемся, что URL заканчивается на слэш
    const url = bitrixWebhookUrl.endsWith('/') 
      ? `${bitrixWebhookUrl}crm.lead.add`
      : `${bitrixWebhookUrl}/crm.lead.add`;
    
    const response = await axios.post(
      url,
      leadData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    return {
      success: true,
      leadId: response.data.result,
      data: response.data
    };
  } catch (error) {
    console.error('Ошибка при создании лида в Bitrix:', error.response?.data || error.message);
    throw new Error(`Ошибка при создании лида в Bitrix: ${error.response?.data?.error_description || error.message}`);
  }
}

/**
 * Обработчик вебхука от Sasha AI
 */
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = req.body; // Теперь это строка благодаря express.text()
  const secret = process.env.WEBHOOK_SECRET;
  
  // Проверка наличия необходимых данных
  if (!signature) {
    return res.status(401).send('Отсутствует заголовок X-Webhook-Signature');
  }
  
  if (!secret) {
    return res.status(500).send('WEBHOOK_SECRET не настроен');
  }
  
  if (!payload) {
    return res.status(400).send('Тело запроса пустое');
  }
  
  

  try {
    const data = JSON.parse(payload);
    
    // Валидация наличия данных
    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Данные не предоставлены. Отправьте JSON в теле запроса'
      });
    }
    
    // Валидация обязательных полей
    if (!data.contact || !data.call) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: contact или call'
      });
    }
    
    // Создание лида в Bitrix
    const result = await createLeadInBitrix(data);
    
    res.json({
      success: true,
      message: 'Лид успешно создан в Bitrix',
      leadId: result.leadId,
      data: result.data
    });
  } catch (error) {
    console.error('Ошибка при обработке запроса:', error);
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
  try {
    const data = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Данные не предоставлены. Отправьте JSON в теле запроса'
      });
    }

    // Минимальная валидация как в /webhook
    if (!data.contact || !data.call) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: contact или call'
      });
    }

    const result = await createLeadInBitrix(data);

    return res.json({
      success: true,
      message: 'Тестовый лид успешно создан в Bitrix',
      leadId: result.leadId,
      data: result.data
    });
  } catch (error) {
    console.error('Ошибка при тестовой отправке в Bitrix:', error);
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
