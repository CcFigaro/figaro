(function () {
  'use strict';

  var state = document.getElementById('estado');
  var root = document.getElementById('formulario');
  var supported = ['unica', 'multiple', 'escala', 'nps', 'numero', 'texto', 'texto_largo'];
  var config = window.FIGARO_SURVEYS || {};

  function show(message, kind) {
    state.textContent = message || '';
    state.className = message ? 'aviso' + (kind ? ' aviso--' + kind : '') : 'aviso';
  }

  function node(tag, className, text) {
    var item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = text;
    return item;
  }

  function control(question, type, value) {
    var label = node('label', 'opcion');
    var input = document.createElement('input');
    input.type = type;
    input.name = question.id;
    input.value = value;
    if (question.tipo === 'unica' && question.requerida) input.required = true;
    label.appendChild(input);
    label.appendChild(node('span', '', value));
    return label;
  }

  function questionControl(question, index) {
    var section = node('section', 'pregunta');
    var label = node('label', '', (index + 1) + '. ' + question.texto + (question.requerida ? ' *' : ''));
    section.appendChild(label);
    var id = 'q-' + question.id;
    label.htmlFor = id;

    if (question.tipo === 'unica' || question.tipo === 'multiple') {
      var choices = node('div', 'opciones');
      (question.opciones || []).forEach(function (option) {
        choices.appendChild(control(question, question.tipo === 'multiple' ? 'checkbox' : 'radio', option));
      });
      section.appendChild(choices);
    } else if (question.tipo === 'escala' || question.tipo === 'nps') {
      var scale = node('div', 'escala');
      var min = Number(question.min == null ? (question.tipo === 'nps' ? 0 : 1) : question.min);
      var max = Number(question.max == null ? (question.tipo === 'nps' ? 10 : 5) : question.max);
      for (var value = min; value <= max; value += 1) {
        var item = node('label');
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = question.id;
        input.value = String(value);
        input.required = !!question.requerida;
        item.appendChild(input);
        item.appendChild(node('span', '', String(value)));
        scale.appendChild(item);
      }
      section.appendChild(scale);
    } else {
      var input = document.createElement(question.tipo === 'texto_largo' ? 'textarea' : 'input');
      input.id = id;
      input.name = question.id;
      input.required = !!question.requerida;
      if (question.tipo === 'numero') {
        input.type = 'number';
        input.step = 'any';
      } else if (question.tipo === 'texto') {
        input.type = 'text';
        input.maxLength = 5000;
      } else {
        input.maxLength = 5000;
      }
      section.appendChild(input);
    }
    return section;
  }

  function readAnswers(form, questions) {
    var answers = {};
    questions.forEach(function (question) {
      var checked = Array.prototype.slice.call(form.querySelectorAll('[name="' + question.id + '"]:checked'));
      if (question.tipo === 'multiple') {
        answers[question.id] = checked.map(function (input) { return input.value; });
      } else if (question.tipo === 'unica') {
        if (checked.length) answers[question.id] = checked[0].value;
      } else if (question.tipo === 'escala' || question.tipo === 'nps') {
        if (checked.length) answers[question.id] = Number(checked[0].value);
      } else {
        var input = form.querySelector('[name="' + question.id + '"]');
        if (input && input.value.trim() !== '') {
          answers[question.id] = question.tipo === 'numero'
            ? Number(input.value) : input.value.trim();
        }
      }
    });
    return answers;
  }

  function renderSurvey(client, survey) {
    root.textContent = '';
    var card = node('article', 'formulario');
    card.appendChild(node('span', 'etiqueta', 'FIGARÓ · Encuesta'));
    card.appendChild(node('h1', '', survey.title));
    if (survey.description) card.appendChild(node('p', 'subtitulo', survey.description));
    var form = node('form', 'preguntas-formulario');
    survey.questions.forEach(function (question, index) {
      form.appendChild(questionControl(question, index));
    });
    var consent = node('label', 'consentimiento');
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.required = true;
    checkbox.name = 'consentimiento';
    consent.appendChild(checkbox);
    consent.appendChild(node('span', '', 'Acepto participar voluntariamente. Mis respuestas se utilizarán de forma agregada para fines de investigación. No se solicitan datos de identidad.'));
    form.appendChild(consent);
    var submit = node('button', 'boton boton--principal', 'Enviar respuestas');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var answers = readAnswers(form, survey.questions);
      var unanswered = survey.questions.some(function (question) {
        var answer = answers[question.id];
        return question.requerida &&
          (answer === undefined || answer === '' || (Array.isArray(answer) && !answer.length));
      });
      if (unanswered) {
        show('Completa todas las preguntas obligatorias.', 'error');
        return;
      }
      submit.disabled = true;
      show('Enviando tu respuesta…');
      client.from('survey_responses').insert({
        survey_id: survey.id,
        answers: answers,
        consent: checkbox.checked
      }).then(function (result) {
        if (result.error) throw result.error;
        card.textContent = '';
        card.className = 'formulario';
        card.appendChild(node('span', 'etiqueta', 'FIGARÓ · Encuesta'));
        card.appendChild(node('h1', '', '¡Gracias por participar!'));
        card.appendChild(node('p', 'subtitulo', 'Tu respuesta se registró correctamente.'));
        show('', '');
      }).catch(function (error) {
        submit.disabled = false;
        console.error('No se pudo guardar la respuesta de la encuesta:', error);
        show('No se pudo enviar la respuesta. Comprueba tu conexión e inténtalo de nuevo.', 'error');
      });
    });
    card.appendChild(form);
    card.appendChild(node('p', 'formulario__pie', 'Tus respuestas no son visibles para otras personas.'));
    root.appendChild(card);
    show('');
  }

  function start() {
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
      show('Esta encuesta todavía no está disponible.', 'error');
      return;
    }
    var id = new URLSearchParams(window.location.search).get('id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      show('El enlace de la encuesta no es válido.', 'error');
      return;
    }
    var client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    client.rpc('get_public_survey', { p_public_id: id })
      .then(function (result) {
        if (result.error) throw result.error;
        var survey = result.data;
        if (!survey) throw new Error('Survey not found');
        if (!Array.isArray(survey.questions) || !survey.questions.length ||
          survey.questions.some(function (question) {
            return !question.id || !question.texto || supported.indexOf(question.tipo) === -1;
          })) throw new Error('El formulario no está disponible.');
        renderSurvey(client, survey);
      }).catch(function () { show('El enlace no está activo o la encuesta ya fue cerrada.', 'error'); });
  }

  start();
})();
