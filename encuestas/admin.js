(function () {
  'use strict';

  var app = document.getElementById('app');
  var statusBox = document.getElementById('estado');
  var client = null;
  var session = null;
  var currentSurvey = null;
  var questions = [];

  function status(message, kind) {
    statusBox.textContent = message || '';
    statusBox.className = message ? 'aviso' + (kind ? ' aviso--' + kind : '') : 'aviso';
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(text, className, onClick) {
    var node = element('button', 'boton' + (className ? ' ' + className : ''), text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function configure() {
    var config = window.FIGARO_SURVEYS || {};
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      status('Falta configurar la URL y la clave pública de Supabase en encuestas/config.js. No pegues aquí la clave service_role.', 'error');
      return false;
    }
    if (!window.supabase || !window.supabase.createClient) {
      status('No se pudo cargar el cliente de Supabase. Comprueba tu conexión a Internet.', 'error');
      return false;
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    return true;
  }

  function renderLogin() {
    app.textContent = '';
    var panel = element('section', 'panel');
    panel.appendChild(element('span', 'etiqueta', 'FIGARÓ · Acceso privado'));
    panel.appendChild(element('h1', '', 'Administrar encuestas'));
    panel.appendChild(element('p', 'subtitulo', 'Accede para diseñar formularios y descargar las respuestas. El registro público está desactivado.'));
    var form = element('form', '');
    [['Correo electrónico', 'email'], ['Contraseña', 'password']].forEach(function (field, index) {
      var wrap = element('div', 'campo');
      var label = element('label', '', field[0]);
      var input = element('input');
      input.type = field[1];
      input.required = true;
      input.autocomplete = index ? 'current-password' : 'username';
      input.id = index ? 'password' : 'email';
      label.htmlFor = input.id;
      wrap.appendChild(label);
      wrap.appendChild(input);
      form.appendChild(wrap);
    });
    var actions = element('div', 'acciones');
    var submit = element('button', 'boton boton--principal', 'Entrar');
    submit.type = 'submit';
    actions.appendChild(submit);
    form.appendChild(actions);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submit.disabled = true;
      status('Verificando acceso…');
      client.auth.signInWithPassword({
        email: form.querySelector('#email').value.trim(),
        password: form.querySelector('#password').value
      }).then(function (result) {
        if (result.error) throw result.error;
        session = result.data.session;
        return verifyAdmin().then(function (authorized) {
          if (!authorized) {
            session = null;
            return client.auth.signOut().then(function () {
              throw new Error('Esta cuenta no tiene autorización para administrar encuestas.');
            });
          }
          return renderDashboard();
        });
      }).catch(function (error) {
        status('No se pudo iniciar sesión: ' + error.message, 'error');
      }).finally(function () { submit.disabled = false; });
    });
    panel.appendChild(form);
    app.appendChild(panel);
  }

  function renderDashboard() {
    app.textContent = '';
    var panel = element('section', 'panel');
    var header = element('div', 'cabecera-panel');
    var heading = element('div');
    heading.appendChild(element('span', 'etiqueta', 'FIGARÓ · Panel privado'));
    heading.appendChild(element('h1', '', 'Tus encuestas'));
    heading.appendChild(element('p', 'subtitulo', session.user.email));
    header.appendChild(heading);
    var controls = element('div', 'acciones');
    controls.appendChild(button('Nueva encuesta', 'boton--principal', function () {
      openEditor(null);
    }));
    controls.appendChild(button('Cerrar sesión', '', function () {
      client.auth.signOut().then(function (result) {
        if (result.error) throw result.error;
        session = null;
        renderLogin();
        status('');
      }).catch(function (error) { status('No se pudo cerrar la sesión: ' + error.message, 'error'); });
    }));
    header.appendChild(controls);
    panel.appendChild(header);
    panel.appendChild(element('p', 'ayuda', 'Las respuestas son privadas y solo se pueden consultar desde esta cuenta. Exporta un paquete JSON para analizarlo en Mirador.'));
    var list = element('div');
    list.id = 'lista-encuestas';
    list.appendChild(element('p', 'ayuda', 'Cargando encuestas…'));
    panel.appendChild(list);
    app.appendChild(panel);
    return loadSurveys(list);
  }

  function loadSurveys(list) {
    return client.from('surveys').select('id,public_id,title,description,questions,is_published,created_at')
      .order('created_at', { ascending: false }).then(function (result) {
        if (result.error) throw result.error;
        list.textContent = '';
        if (!result.data.length) {
          list.appendChild(element('p', 'aviso', 'Todavía no hay encuestas. Pulsa «Nueva encuesta» para crear la primera.'));
          return;
        }
        result.data.forEach(function (survey) {
          var row = element('article', 'fila-encuesta');
          var info = element('div');
          info.appendChild(element('h3', '', survey.title));
          info.appendChild(element('p', 'meta', survey.questions.length + ' preguntas · ' + (survey.is_published ? 'Publicada' : 'Borrador')));
          row.appendChild(info);
          var actions = element('div', 'acciones');
          actions.appendChild(button('Editar', '', function () { openEditor(survey); }));
          actions.appendChild(button('Respuestas / exportar', '', function () { openResponses(survey); }));
          row.appendChild(actions);
          list.appendChild(row);
        });
      }).catch(function (error) { status('No se pudieron cargar las encuestas: ' + error.message, 'error'); });
  }

  function newQuestion() {
    return { id: crypto.randomUUID(), texto: '', tipo: 'unica', opciones: ['Sí', 'No'], min: 1, max: 5, requerida: false };
  }

  function openEditor(survey) {
    currentSurvey = survey ? Object.assign({}, survey) : null;
    questions = survey ? survey.questions.map(function (item) {
      return Object.assign({}, item, { opciones: Array.isArray(item.opciones) ? item.opciones.slice() : [] });
    }) : [newQuestion()];
    app.textContent = '';
    var panel = element('section', 'panel');
    panel.appendChild(element('span', 'etiqueta', 'Diseño de encuesta'));
    panel.appendChild(element('h1', '', survey ? 'Editar encuesta' : 'Nueva encuesta'));
    var form = element('form');
    form.id = 'editor';

    addField(form, 'Título', 'titulo', survey ? survey.title : '', 'text', true, 200);
    var descriptionWrap = element('div', 'campo');
    var descriptionLabel = element('label', '', 'Descripción para participantes');
    descriptionLabel.htmlFor = 'descripcion';
    var description = element('textarea');
    description.id = 'descripcion';
    description.maxLength = 2000;
    description.value = survey ? survey.description : '';
    descriptionWrap.appendChild(descriptionLabel);
    descriptionWrap.appendChild(description);
    form.appendChild(descriptionWrap);

    var questionHeading = element('div', 'cabecera-panel');
    questionHeading.appendChild(element('h2', '', 'Preguntas'));
    questionHeading.appendChild(button('Añadir pregunta', '', function () {
      questions.push(newQuestion());
      renderQuestions(list, questions);
    }));
    form.appendChild(questionHeading);
    var list = element('div', 'lista-preguntas');
    renderQuestions(list, questions);
    form.appendChild(list);

    var actions = element('div', 'acciones');
    var save = element('button', 'boton boton--principal', 'Guardar borrador');
    save.type = 'submit';
    actions.appendChild(save);
    if (survey) {
      actions.appendChild(button(survey.is_published ? 'Copiar enlace público' : 'Publicar encuesta', '', function () {
        if (currentSurvey.is_published) copyShareLink(currentSurvey);
        else saveSurvey(true);
      }));
      if (survey.is_published) actions.appendChild(button('Cerrar encuesta', 'boton--peligro', function () {
        saveSurvey(false);
      }));
    } else {
      actions.appendChild(button('Guardar y publicar', '', function () { saveSurvey(true); }));
    }
    actions.appendChild(button('Volver', '', renderDashboard));
    form.appendChild(actions);
    panel.appendChild(form);
    app.appendChild(panel);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      saveSurvey(currentSurvey ? currentSurvey.is_published : false);
    });
  }

  function addField(form, labelText, id, value, type, required, maxLength) {
    var wrap = element('div', 'campo');
    var label = element('label', '', labelText);
    var input = element('input');
    input.type = type;
    input.id = id;
    input.value = value || '';
    input.required = required;
    if (maxLength) input.maxLength = maxLength;
    label.htmlFor = id;
    wrap.appendChild(label);
    wrap.appendChild(input);
    form.appendChild(wrap);
  }

  function renderQuestions(list, items) {
    list.textContent = '';
    items.forEach(function (question, index) {
      var card = element('article', 'pregunta-editor');
      var header = element('div', 'pregunta-editor__cabecera');
      header.appendChild(element('strong', '', 'Pregunta ' + (index + 1)));
      header.appendChild(button('Eliminar', 'boton--peligro', function () {
        questions = questions.filter(function (item) { return item.id !== question.id; });
        renderQuestions(list, questions);
      }));
      card.appendChild(header);
      var textWrap = element('div', 'campo');
      var textLabel = element('label', '', 'Texto');
      var text = element('input');
      text.type = 'text';
      text.maxLength = 500;
      text.required = true;
      text.value = question.texto;
      textLabel.appendChild(text);
      textWrap.appendChild(textLabel);
      card.appendChild(textWrap);

      var grid = element('div', 'rejilla');
      var typeWrap = element('div', 'campo');
      typeWrap.appendChild(element('label', '', 'Tipo de respuesta'));
      var type = element('select');
      [
        ['unica', 'Opción única'], ['multiple', 'Opción múltiple'], ['escala', 'Escala'],
        ['nps', 'Recomendación 0–10'], ['numero', 'Numérica'], ['texto', 'Texto corto'], ['texto_largo', 'Texto largo']
      ].forEach(function (option) {
        var node = element('option', '', option[1]);
        node.value = option[0];
        node.selected = question.tipo === option[0];
        type.appendChild(node);
      });
      typeWrap.appendChild(type);
      var requiredLabel = element('label', 'checkbox');
      var required = element('input');
      required.type = 'checkbox';
      required.checked = !!question.requerida;
      requiredLabel.appendChild(required);
      requiredLabel.appendChild(element('span', '', 'Respuesta obligatoria'));
      grid.appendChild(typeWrap);
      grid.appendChild(requiredLabel);
      card.appendChild(grid);

      var optionsWrap = element('div', 'campo');
      var optionsLabel = element('label', '', 'Opciones (una por línea)');
      var options = element('textarea');
      options.value = (question.opciones || []).join('\n');
      optionsLabel.appendChild(options);
      optionsWrap.appendChild(optionsLabel);
      optionsWrap.hidden = question.tipo !== 'unica' && question.tipo !== 'multiple';
      card.appendChild(optionsWrap);

      var range = element('div', 'rejilla');
      var rangeInputs = {};
      [['Mínimo', 'min', question.min == null ? (question.tipo === 'nps' ? 0 : 1) : question.min],
        ['Máximo', 'max', question.max == null ? (question.tipo === 'nps' ? 10 : 5) : question.max]].forEach(function (field) {
        var wrap = element('div', 'campo');
        var label = element('label', '', field[0]);
        var input = element('input');
        input.type = 'number';
        input.value = field[2];
        input.disabled = question.tipo === 'nps';
        rangeInputs[field[1]] = input;
        label.appendChild(input);
        wrap.appendChild(label);
        range.appendChild(wrap);
        input.addEventListener('input', function () { question[field[1]] = Number(input.value); });
      });
      range.hidden = question.tipo !== 'escala' && question.tipo !== 'nps';
      card.appendChild(range);

      text.addEventListener('input', function () { question.texto = text.value.trim(); });
      required.addEventListener('change', function () { question.requerida = required.checked; });
      options.addEventListener('input', function () {
        question.opciones = options.value.split(/\r?\n/).map(function (value) { return value.trim(); }).filter(Boolean);
      });
      type.addEventListener('change', function () {
        question.tipo = type.value;
        optionsWrap.hidden = question.tipo !== 'unica' && question.tipo !== 'multiple';
        range.hidden = question.tipo !== 'escala' && question.tipo !== 'nps';
        if (question.tipo === 'nps') { question.min = 0; question.max = 10; }
        if (question.tipo === 'escala') { question.min = 1; question.max = 5; }
        rangeInputs.min.value = question.min;
        rangeInputs.max.value = question.max;
        rangeInputs.min.disabled = question.tipo === 'nps';
        rangeInputs.max.disabled = question.tipo === 'nps';
        if ((question.tipo === 'unica' || question.tipo === 'multiple') && !question.opciones.length) {
          question.opciones = ['Opción 1', 'Opción 2'];
          options.value = question.opciones.join('\n');
        }
      });
      list.appendChild(card);
    });
  }

  function validatedQuestions() {
    var items = questions.map(function (question) {
      return {
        id: question.id || crypto.randomUUID(),
        texto: String(question.texto || '').trim(),
        tipo: question.tipo,
        opciones: (question.opciones || []).map(function (option) { return String(option).trim(); }).filter(Boolean),
        min: Number(question.min == null ? (question.tipo === 'nps' ? 0 : 1) : question.min),
        max: Number(question.max == null ? (question.tipo === 'nps' ? 10 : 5) : question.max),
        requerida: !!question.requerida
      };
    });
    if (!items.length || items.length > 100) throw new Error('Añade entre 1 y 100 preguntas.');
    items.forEach(function (question) {
      if (!question.texto) throw new Error('Completa el texto de todas las preguntas.');
      if ((question.tipo === 'unica' || question.tipo === 'multiple') && !question.opciones.length) {
        throw new Error('Cada pregunta de opciones necesita al menos una opción.');
      }
      if ((question.tipo === 'escala' || question.tipo === 'nps') &&
        (!Number.isInteger(question.min) || !Number.isInteger(question.max) ||
          (question.tipo === 'escala' && question.max <= question.min) ||
          (question.tipo === 'nps' && question.max < question.min) || question.max - question.min > 100)) {
        throw new Error('Comprueba el rango de las preguntas de escala.');
      }
      if (question.tipo === 'nps' && (question.min !== 0 || question.max !== 10)) {
        throw new Error('Las preguntas NPS deben usar una escala de 0 a 10.');
      }
    });
    if (items.some(function (question, index) {
      return items.some(function (other, otherIndex) {
        return index !== otherIndex && question.id === other.id;
      });
    })) throw new Error('Hay identificadores de pregunta repetidos; vuelve a crear la pregunta.');
    return items;
  }

  function saveSurvey(publish) {
    var form = document.getElementById('editor');
    if (!form.reportValidity()) return;
    var title = form.querySelector('#titulo').value.trim();
    if (!title) { status('Escribe el título de la encuesta.', 'error'); return; }
    var payload;
    try {
      payload = {
        title: title,
        description: form.querySelector('#descripcion').value.trim(),
        questions: validatedQuestions(),
        is_published: !!publish,
        updated_at: new Date().toISOString()
      };
    } catch (error) { status(error.message, 'error'); return; }
    if (currentSurvey) payload.id = currentSurvey.id;
    else {
      payload.public_id = crypto.randomUUID();
      payload.created_by = session.user.id;
    }
    status(publish ? 'Publicando encuesta…' : 'Guardando borrador…');
    var request = currentSurvey
      ? client.from('surveys').update(payload).eq('id', currentSurvey.id).select().single()
      : client.from('surveys').insert(payload).select().single();
    request.then(function (result) {
      if (result.error) throw result.error;
      currentSurvey = result.data;
      if (publish) {
        status('Encuesta publicada. Puedes copiar y compartir el enlace.', 'ok');
        openEditor(currentSurvey);
      } else {
        status('Borrador guardado.', 'ok');
        openEditor(currentSurvey);
      }
    }).catch(function (error) { status('No se pudo guardar: ' + error.message, 'error'); });
  }

  function shareUrl(survey) {
    var config = window.FIGARO_SURVEYS || {};
    var link = new URL('encuestas/responder.html', config.siteUrl || window.location.href);
    link.searchParams.set('id', survey.public_id);
    return link.href;
  }

  function copyShareLink(survey) {
    navigator.clipboard.writeText(shareUrl(survey)).then(function () {
      status('Enlace copiado: ' + shareUrl(survey), 'ok');
    }).catch(function () {
      window.prompt('Copia el enlace de la encuesta:', shareUrl(survey));
    });
  }

  function openResponses(survey) {
    status('Cargando respuestas privadas…');
    loadResponsePage(survey, 0, []).catch(function (error) {
      status('No se pudieron consultar las respuestas: ' + error.message, 'error');
    });
  }

  function loadResponsePage(survey, offset, accumulated) {
    var pageSize = 500;
    return client.from('survey_responses').select('id,answers,consent,submitted_at')
      .eq('survey_id', survey.id).order('submitted_at', { ascending: true })
      .range(offset, offset + pageSize - 1).then(function (result) {
        if (result.error) throw result.error;
        var all = accumulated.concat(result.data);
        if (result.data.length === pageSize) return loadResponsePage(survey, offset + pageSize, all);
        renderResponses(survey, all);
      });
  }

  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function slug(text) {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'encuesta';
  }

  function csvCell(value) {
    var text = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function renderResponses(survey, responses) {
    app.textContent = '';
    var panel = element('section', 'panel');
    panel.appendChild(element('span', 'etiqueta', 'Respuestas privadas'));
    panel.appendChild(element('h1', '', survey.title));
    panel.appendChild(element('p', 'subtitulo', responses.length + ' respuestas recibidas'));
    var actions = element('div', 'acciones');
    actions.appendChild(button('Descargar paquete para Mirador (.json)', 'boton--principal', function () {
      var packageData = {
        format: 'figaro-mirador-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        survey: {
          id: survey.public_id,
          title: survey.title,
          description: survey.description || '',
          createdAt: survey.created_at,
          questions: survey.questions
        },
        responses: responses.map(function (response) {
          return {
            id: response.id,
            fecha: response.submitted_at,
            canal: 'web',
            meta: {},
            items: response.answers
          };
        })
      };
      download('figaro-' + slug(survey.title) + '-mirador.json', JSON.stringify(packageData, null, 2), 'application/json;charset=utf-8');
    }));
    actions.appendChild(button('Descargar CSV', '', function () {
      var rows = [['fecha'].concat(survey.questions.map(function (question) { return question.texto; }))];
      responses.forEach(function (response) {
        rows.push([response.submitted_at].concat(survey.questions.map(function (question) {
          var answer = response.answers[question.id];
          return Array.isArray(answer) ? answer.join(' | ') : answer;
        })));
      });
      var content = '\ufeff' + rows.map(function (row) { return row.map(csvCell).join(';'); }).join('\r\n');
      download('figaro-' + slug(survey.title) + '-respuestas.csv', content, 'text/csv;charset=utf-8');
    }));
    actions.appendChild(button('Copiar enlace público', '', function () { copyShareLink(survey); }));
    actions.appendChild(button('Volver', '', renderDashboard));
    panel.appendChild(actions);
    panel.appendChild(element('p', 'ayuda', 'El archivo JSON conserva el tipo de pregunta y sus opciones para analizar correctamente los datos en la app local Mirador. El CSV sirve para abrir los datos en una hoja de cálculo.'));
    var preview = element('p', 'meta', 'Vista previa limitada a las primeras 5 respuestas.');
    panel.appendChild(preview);
    responses.slice(0, 5).forEach(function (response, index) {
      var summary = element('details', 'pregunta-editor');
      var heading = element('summary', '', 'Respuesta ' + (index + 1) + ' · ' + new Date(response.submitted_at).toLocaleString());
      summary.appendChild(heading);
      survey.questions.forEach(function (question) {
        var value = response.answers[question.id];
        summary.appendChild(element('p', 'ayuda', question.texto + ': ' + (Array.isArray(value) ? value.join(', ') : (value == null ? '—' : String(value)))));
      });
      panel.appendChild(summary);
    });
    app.appendChild(panel);
    status('');
  }

  function start() {
    if (!configure()) return;
    status('Comprobando sesión…');
    client.auth.getSession().then(function (result) {
      if (result.error) throw result.error;
      session = result.data.session;
      status('');
      if (!session) return renderLogin();
      return verifyAdmin().then(function (authorized) {
        if (!authorized) {
          session = null;
          return client.auth.signOut().then(function () {
            renderLogin();
            status('Esta cuenta no tiene autorización para administrar encuestas.', 'error');
          });
        }
        return renderDashboard();
      });
    }).catch(function (error) {
      status('No se pudo comprobar el acceso: ' + error.message, 'error');
    });
    client.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') {
        session = null;
        renderLogin();
      }
    });
  }

  function verifyAdmin() {
    return client.rpc('is_survey_admin').then(function (result) {
      if (result.error) throw result.error;
      return result.data === true;
    });
  }

  start();
})();
