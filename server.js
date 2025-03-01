// Charger les variables d'environnement du fichier .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialiser l'application Express
const app = express();

// Middleware
app.use(cors()); // Permet les requêtes cross-origin
app.use(bodyParser.json()); // Parse les requêtes JSON

// Route pour vérifier que le serveur fonctionne
app.get('/', (req, res) => {
  res.send('Serveur de paiement Global Deliver opérationnel! API prête pour les paiements.');
});

// 1. Récupérer les méthodes de paiement d'un client
app.get('/payment-methods/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    console.log(`Récupération des méthodes de paiement pour le customer: ${customerId}`);
    
    if (!customerId) {
      return res.status(400).json({ error: 'ID client requis' });
    }

    // Vérifier d'abord que le customer existe
    try {
      await stripe.customers.retrieve(customerId);
    } catch (error) {
      console.error(`Customer non trouvé: ${customerId}`, error);
      // Si le customer n'existe pas, on renvoie un tableau vide plutôt qu'une erreur
      return res.json({ data: [] });
    }
    
    // Récupérer les méthodes de paiement enregistrées
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card'
    });
    
    console.log(`${paymentMethods.data.length} méthodes de paiement trouvées`);
    
    res.json(paymentMethods.data);
  } catch (error) {
    console.error('Erreur:', error);
    // En cas d'erreur, on renvoie un tableau vide avec un message
    res.json({ data: [], error: error.message });
  }
});

// 2. Supprimer une méthode de paiement
app.post('/detach-payment-method', async (req, res) => {
  try {
    const { paymentMethodId } = req.body;
    
    if (!paymentMethodId) {
      return res.status(400).json({ error: 'ID méthode de paiement requis' });
    }
    
    // Détacher la méthode de paiement
    const paymentMethod = await stripe.paymentMethods.detach(paymentMethodId);
    
    res.json({ success: true, paymentMethod });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Endpoint pour créer un SetupIntent (pour ajouter une carte sans paiement)
app.post('/create-setup-intent', async (req, res) => {
  try {
    const { customerId, email = 'client@example.com' } = req.body;
    
    // Utiliser le customer ID existant ou en créer un nouveau
    let customer;
    if (customerId) {
      // Vérifier si le customer existe
      try {
        customer = await stripe.customers.retrieve(customerId);
      } catch (e) {
        // Si non, en créer un nouveau
        customer = await stripe.customers.create({ email });
      }
    } else {
      // Créer un nouveau customer
      customer = await stripe.customers.create({ email });
    }
    
    // Créer une clé éphémère
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2025-02-24.acacia' }
    );
    
    // Créer un SetupIntent
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
    });
    
    res.json({
      setupIntent: setupIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// Route principale pour créer un PaymentIntent
app.post('/create-payment-intent', async (req, res) => {
  try {
    console.log('Requête reçue:', req.body);
    
    // Extraire les données de la requête
    const { amount, email = 'client@example.com', payment_method = null, customerId = null } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Montant invalide. Veuillez fournir un montant positif.' });
    }
    
    console.log(`Création d'un PaymentIntent: ${amount} centimes pour ${email}`);
    
    // Créer ou réutiliser un customer
    let customer;

    // Si un customerId est fourni, essayer de l'utiliser d'abord
    if (customerId) {
      try {
        customer = await stripe.customers.retrieve(customerId);
        console.log(`Customer existant trouvé: ${customer.id}`);
      } catch (e) {
        console.log(`Customer ID invalide ou expiré, création d'un nouveau customer`);
        customer = await stripe.customers.create({ email });
        console.log(`Nouveau customer créé: ${customer.id}`);
      }
    } 
    // Si une méthode de paiement est fournie, trouver le customer associé
    else if (payment_method) {
      try {
        const paymentMethod = await stripe.paymentMethods.retrieve(payment_method);
        if (paymentMethod.customer) {
          customer = { id: paymentMethod.customer };
          console.log(`Customer trouvé via payment method: ${customer.id}`);
        } else {
          customer = await stripe.customers.create({ email });
          console.log(`Nouveau customer créé pour payment method: ${customer.id}`);
        }
      } catch (e) {
        customer = await stripe.customers.create({ email });
        console.log(`Erreur avec payment method, nouveau customer créé: ${customer.id}`);
      }
    } 
    // Sinon créer un nouveau customer
    else {
      customer = await stripe.customers.create({ email });
      console.log(`Nouveau customer créé: ${customer.id}`);
    }

    // Créer une clé éphémère pour ce customer
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2025-02-24.acacia' }
    );
    console.log('Clé éphémère créée');

    // Options de base pour le PaymentIntent
    const paymentIntentOptions = {
      amount: amount,
      currency: 'mad', // MAD pour Dirham marocain
      customer: customer.id,
      setup_future_usage: 'off_session', // Important: permet de sauvegarder la carte
      automatic_payment_methods: {
        enabled: !payment_method, // Désactiver si on utilise une méthode spécifique
      },
    };

    // Si une méthode de paiement est fournie, l'utiliser
    if (payment_method) {
      paymentIntentOptions.payment_method = payment_method;
      // Note: on ne met pas off_session à true pour éviter des problèmes d'authentification 3DS
      //paymentIntentOptions.off_session = true;
      //paymentIntentOptions.confirm = true;
    }
    
    // Créer le PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentOptions);
    console.log(`PaymentIntent créé avec ID: ${paymentIntent.id}`);

    // Renvoyer les informations nécessaires au client
    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
    
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ 
      error: error.message,
      //stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Démarrer le serveur
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log(`Serveur Global Deliver démarré sur le port ${PORT}`);
  //console.log('Endpoints disponibles:');
  //console.log('  GET  / - Page d\'accueil');
  //console.log('  POST /create-payment-intent - Créer un PaymentIntent');
});