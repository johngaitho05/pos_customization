odoo.define('pos_customization.pos', function (require) {
    "use strict";

    var screens = require('point_of_sale.screens');
    var gui = require('point_of_sale.gui');
    var models = require('point_of_sale.models');
    var utils = require('web.utils');
    var core = require('web.core');
    var QWeb = core.qweb;
    var SuperPosModel = models.PosModel.prototype;
    var PopupWidget = require('point_of_sale.popups');
    var rpc = require('web.rpc');

    var _t = core._t;

    models.load_models([
        {
            model: 'assurance.company',
            fields: ['name', 'pricelist_id'],
            loaded: function(self, assurance_company) {
                var companies = [];
                for (var i = 0; i < assurance_company.length; i++){
                    companies[assurance_company[i].id] = assurance_company[i];
                }
                self.assurance_companies = companies;
                self.assurance_company = assurance_company;
            },
        }], {
        'after': 'product.product'
    });

    models.PosModel = models.PosModel.extend({
        initialize: function (session, attributes) {
            var res = SuperPosModel.initialize.call(this, session, attributes);
            var partner_model = _.find(this.models, function(model){ return model.model === 'res.partner'; });
            partner_model.fields.push('principal_name', 'principal_relationship', 'patient_name', 'affiliation_number',
                'client_contribution', 'card_validity', 'employer', 'assurance_company','principal_id');
            var payment_method_model = _.find(this.models, function(model){ return model.model === 'pos.payment.method'; });
            payment_method_model.fields.push('is_assurance', 'is_rssb_card', 'assurance_company_id');
            return res;
        },
        get_assurance_pricelist: function(client) {
            var self = this;
            var order = self.get_order();
            var pricelist_by_id = {};
            _.each(self.pricelists, function (pricelist) {
                pricelist_by_id[pricelist.id] = pricelist;
            });
            var total_amount = 0;
            if (client && client.assurance_company) {
                var currentDate = new Date();
                var dateToCompare = new Date(Date.parse(client.card_validity));
                if (currentDate <= dateToCompare && client.affiliation_number && client.client_contribution) {
                    var assurance = self.assurance_companies[client.assurance_company[0]];
                    // self.assurance_company = assurance;
                    var pricelist = pricelist_by_id[assurance.pricelist_id[0]];
                    if (pricelist) {
                        var price = 0;
                        var template_ids = [];
                        for (var i = 0; i < pricelist.items.length; i++){
                            if (pricelist.items[i].applied_on == '3_global'){
                                total_amount = order.get_due() || order.get_total_with_tax();
                            } else {
                                var orderlines = order.get_orderlines();
                                if (pricelist.items[i].product_tmpl_id){
                                    template_ids.push(pricelist.items[i].product_tmpl_id[0]);
                                }
                            }
                        }
                        if (template_ids.length > 0) {
                            for (var i = 0; i < orderlines.length; i++){
                                if (template_ids.indexOf(orderlines[i].product.product_tmpl_id) > -1){
                                    orderlines[i].set_unit_price(orderlines[i].product.get_price(pricelist, orderlines[i].get_quantity()));
                                    var get_price = orderlines[i].get_product().get_price(pricelist, orderlines[i].get_quantity());
                                    var amount_with_qty = get_price * orderlines[i].get_quantity();
                                    price += amount_with_qty;
                                }
                            }
                            total_amount = price;
                        }
                    }
                }
            }
            return total_amount;
        }
    });
    screens.ClientListScreenWidget.include({
        show: function(){
            var self = this;
            this._super();

            this.renderElement();
            this.details_visible = false;
            this.old_client = this.pos.get_order().get_client();

            this.$('.back').click(function(){
                self.gui.back();
            });

            this.$('.next').click(function(){
                self.save_changes();
                self.pos.get_assurance_pricelist(self.pos.get_order().get_client());
                self.gui.back();    // FIXME HUH ?
            });

            this.$('.new-customer').click(function(){
                self.display_client_details('edit',{
                    'country_id': self.pos.company.country_id,
                    'state_id': self.pos.company.state_id,
                });
            });

            var partners = this.pos.db.get_partners_sorted(1000);
            this.render_list(partners);

            this.reload_partners();

            if( this.old_client ){
                this.display_client_details('show',this.old_client,0);
            }

            this.$('.client-list-contents').on('click', '.client-line', function(event){
                self.line_select(event,$(this),parseInt($(this).data('id')));
            });

            var search_timeout = null;

            if(this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard){
                this.chrome.widget.keyboard.connect(this.$('.searchbox input'));
            }

            this.$('.searchbox input').on('keypress',function(event){
                clearTimeout(search_timeout);

                var searchbox = this;

                search_timeout = setTimeout(function(){
                    self.perform_search(searchbox.value, event.which === 13);
                },70);
            });

            this.$('.searchbox .search-clear').click(function(){
                self.clear_search();
            });
        },
        display_client_details: function(visibility,partner,clickpos){
            var self = this;
            var searchbox = this.$('.searchbox input');
            var contents = this.$('.client-details-contents');
            var parent   = this.$('.client-list').parent();
            var scroll   = parent.scrollTop();
            var height   = contents.height();

            contents.off('click','.button.edit');
            contents.off('click','.button.save');
            contents.off('click','.button.undo');
            contents.on('click','.button.edit',function(){ self.edit_client_details(partner); });
            contents.on('click','.button.save',function(){ self.save_client_details(partner); });
            // contents.on('change','.client-relationship',function(){
            //     let val = partner.client_relationship = $('option:selected', this).val()
            //     if(val === "owner") $('.dependant-detail').addClass('hidden');
            // });
            contents.on('click','.button.undo',function(){ self.undo_client_details(partner); });
            this.editing_client = false;
            this.uploaded_picture = null;
            if(visibility === 'show'){
                contents.empty();
                contents.append($(QWeb.render('ClientDetails',{widget:this,partner:partner})));

                var new_height   = contents.height();

                if(!this.details_visible){
                    // resize client list to take into account client details
                    parent.height('-=' + new_height);

                    if(clickpos < scroll + new_height + 20 ){
                        parent.scrollTop( clickpos - 20 );
                    }else{
                        parent.scrollTop(parent.scrollTop() + new_height);
                    }
                }else{
                    parent.scrollTop(parent.scrollTop() - height + new_height);
                }

                this.details_visible = true;
                this.toggle_save_button();
            } else if (visibility === 'edit') {
                // Connect the keyboard to the edited field
                if (this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard) {
                    contents.off('click', '.detail');
                    searchbox.off('click');
                    contents.on('click', '.detail', function(ev){
                        self.chrome.widget.keyboard.connect(ev.target);
                        self.chrome.widget.keyboard.show();
                    });
                    searchbox.on('click', function() {
                        self.chrome.widget.keyboard.connect($(this));
                    });
                }

                this.editing_client = true;
                contents.empty();
                contents.append($(QWeb.render('ClientDetailsEdit',{widget:this,partner:partner})));
                this.toggle_save_button();

                // Browsers attempt to scroll invisible input elements
                // into view (eg. when hidden behind keyboard). They don't
                // seem to take into account that some elements are not
                // scrollable.
                contents.find('input').blur(function() {
                    setTimeout(function() {
                        self.$('.window').scrollTop(0);
                    }, 0);
                });

                contents.find('.client-address-country').on('change', function (ev) {
                    var $stateSelection = contents.find('.client-address-states');
                    var value = this.value;
                    $stateSelection.empty()
                    $stateSelection.append($("<option/>", {
                        value: '',
                        text: 'None',
                    }));
                    self.pos.states.forEach(function (state) {
                        if (state.country_id[0] == value) {
                            $stateSelection.append($("<option/>", {
                                value: state.id,
                                text: state.name
                            }));
                        }
                    });
                });

                contents.find('.image-uploader').on('change',function(event){
                    self.load_image_file(event.target.files[0],function(res){
                        if (res) {
                            contents.find('.client-picture img, .client-picture .fa').remove();
                            contents.find('.client-picture').append("<img src='"+res+"'>");
                            contents.find('.detail.picture').remove();
                            self.uploaded_picture = res;
                        }
                    });
                });
            } else if (visibility === 'hide') {
                contents.empty();
                parent.height('100%');
                if( height > scroll ){
                    contents.css({height:height+'px'});
                    contents.animate({height:0},400,function(){
                        contents.css({height:''});
                    });
                }else{
                    parent.scrollTop( parent.scrollTop() - height);
                }
                this.details_visible = false;
                this.toggle_save_button();
            }
        },
    });

    screens.ActionpadWidget.include({
        renderElement: function() {
            var self = this;
            this._super();
            this.$('.pay').click(function(){
                var order = self.pos.get_order();
                var has_valid_product_lot = _.every(order.orderlines.models, function(line){
                    return line.has_valid_product_lot();
                });
                if(!has_valid_product_lot){
                    self.gui.show_popup('confirm',{
                        'title': _t('Empty Serial/Lot Number'),
                        'body':  _t('One or more product(s) required serial/lot number.'),
                        confirm: function(){
                            self.gui.show_screen('payment');
                        },
                    });
                }else{
                    self.gui.show_screen('payment');
                }
                if (order.attributes.client == null){
                    self.gui.show_popup('confirm', {
                        'title': _t('Please select the Customer'),
                        'body': _t('You need to select a customer for before making payment'),
                        confirm: function(){
                            self.gui.back();
                            self.gui.show_screen('clientlist');
                        },
                    });
                } else {
                    self.get_assurance_card(order.attributes.client);
                }
            });
            this.$('.set-customer').click(function(){
                self.gui.show_screen('clientlist');
            });

        },

        get_assurance_card: function(client) {
            var self = this;
            var order = self.pos.get_order();
            var payment_method = null;
            var currentDate = new Date();
            var dateToCompare = new Date(Date.parse(client.card_validity));
            if (client.assurance_company) {
                for (var i = 0; i < self.pos.payment_methods.length; i++) {
                    if(self.pos.payment_methods[i].is_assurance
                        && self.pos.payment_methods[i].assurance_company_id[0] == client.assurance_company[0]){
                        payment_method = self.pos.payment_methods[i];
                    }
                }
                var total_amount = self.pos.get_assurance_pricelist(client);
                if (currentDate <= dateToCompare && client.affiliation_number && client.client_contribution) {
                    var insurance_amount = (total_amount / 100) * client.client_contribution;
                    if (payment_method && insurance_amount > 0) {
                        if (!order.selected_paymentline) {
                            order.add_paymentline(payment_method);
                            order.selected_paymentline.set_amount( Math.max(insurance_amount),0 );
                            self.chrome.screens.payment.reset_input();
                            self.chrome.screens.payment.render_paymentlines();
                        }
                    }
                } else {
                    self.gui.show_popup('alert', {
                        title: _t('Card Validity is Expired'),
                        body: _t('Make sure you are using card that have all valid details on customer.')
                    });
                }
            }
        }
    });

    screens.PaymentScreenWidget.include({
        events: _.extend({}, screens.PaymentScreenWidget.prototype.events, {
            'click .js_rssb_card': 'click_rssb_card',
        }),
        click_paymentmethods: function(id) {
            var self = this;
            var payment_method = this.pos.payment_methods_by_id[id];
            var order = this.pos.get_order();

            if (order.electronic_payment_in_progress()) {
                this.gui.show_popup('error',{
                    'title': _t('Error'),
                    'body':  _t('There is already an electronic payment in progress.'),
                });
            } else {
                if (payment_method.is_assurance == true) {
                    self.gui.show_popup('alert', {
                        title: _t('Card not Allowed'),
                        body: _t('You are not allowed to use assurance method Manually. it will add Automatically when required!!')
                    });
                } else {
                    order.add_paymentline(payment_method);
                    this.reset_input();

                    this.payment_interface = payment_method.payment_terminal;
                    if (this.payment_interface) {
                        order.selected_paymentline.set_payment_status('pending');
                    }

                    this.render_paymentlines();
                }
            }
        },
        click_rssb_card: function(){
            var self = this;
            var order = self.pos.get_order();
            if(order.get_total_with_tax() <= 0){
                return
            }
            self.gui.show_popup('rssb_card_popup', {'payment_self': self});
        },
    });

    var RSSBCardPopupWidget = PopupWidget.extend({
        template: 'RSSBCardPopupWidget',

        show: function(options){
            self = this;
            this.payment_self = options.payment_self || false;
            this._super();
            $('body').off('keypress', this.payment_self.keyboard_handler);
            $('body').off('keydown',this.payment_self.keyboard_keydown_handler);
            window.document.body.removeEventListener('keypress',self.payment_self.keyboard_handler);
            window.document.body.removeEventListener('keydown',self.payment_self.keyboard_keydown_handler);
            this.renderElement();
            $("#text_rssb_amount").keypress(function (e) {
                if(e.which != 8 && e.which != 0 && (e.which < 48 || e.which > 57) && e.which != 46) {
                    return false;
                }
            });
        },

        click_cancel: function(){
            this._super();
            this.gui.close_popup();
        },

        click_confirm: function(){
            var self = this;
            var order = this.pos.get_order();
            var client = order.get_client();
            var contribution_amount = this.$('#text_rssb_amount').val();
            var card_no = $('#text_rssb_card_no').val();
            var validity_date = $('#rssb_expr_date').val();
            var payment_method = null;
            var currentDate = new Date();
            currentDate.setHours(0, 0, 0, 0);
            var dateToCompare = new Date(Date.parse(validity_date));
            dateToCompare.setHours(0, 0, 0, 0);
            for (var i = 0; i < self.pos.payment_methods.length; i++) {
                if(self.pos.payment_methods[i].is_rssb_card){
                    payment_method = self.pos.payment_methods[i];
                }
            }
            var total_amount = order.get_due() || order.get_total_with_tax();
            var rssb_amount = (total_amount / 100) * contribution_amount;
            if (currentDate <= dateToCompare) {
                if (payment_method){
                    var paymentlines = order.get_paymentlines();
                    var is_rssb = false;
                    for (var i = 0; i < paymentlines.length; i++){
                        if (paymentlines[i].payment_method == payment_method){
                            is_rssb = true;
                        }
                    }
                    if (is_rssb == true){
                        self.gui.show_popup('alert', {
                            title: _t('Card not Allowed'),
                            body: _t('You are not allowed to use two RSSB method at a time.')
                        });
                    } else {
                        order.add_paymentline(payment_method);
                        order.selected_paymentline.set_amount( Math.max(rssb_amount),0 );
                        self.chrome.screens.payment.reset_input();
                        self.chrome.screens.payment.render_paymentlines();
                        self.gui.close_popup();
                    }
                }
            } else {
                self.gui.show_popup('alert', {
                    title: _t('Card Validity is Expired'),
                    body: _t('Make sure you are using card that is validate for today Date.')
                });
            }
        },
    });
    gui.define_popup({name:'rssb_card_popup', widget: RSSBCardPopupWidget});

    function onchange_relationship(){
        console.log("Relationship changed")
    }
});
