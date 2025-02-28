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
    
    if (!customerId) {
      return res.status(400).json({ error: 'ID client requis' });
    }
    
    // Récupérer les méthodes de paiement enregistrées
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card'
    });
    
    res.json(paymentMethods.data);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: error.message });
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
    const { amount, email = 'client@example.com' } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Montant invalide. Veuillez fournir un montant positif.' });
    }
    
    console.log(`Création d'un PaymentIntent: ${amount} centimes pour ${email}`);
    
    // Créer un customer ou utiliser un existant
    const customer = await stripe.customers.create({
      email: email
    });
    console.log(`Customer créé avec ID: ${customer.id}`);

    // Créer une clé éphémère pour ce customer
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2025-02-24.acacia' }
    );
    console.log('Clé éphémère créée');

    // Créer un payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'mad', // MAD pour Dirham marocain
      customer: customer.id,
      automatic_payment_methods: {
        enabled: true,
      },
    });
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