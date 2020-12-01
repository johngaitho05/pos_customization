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
    var PosDB = require('point_of_sale.DB')

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
                'client_contribution', 'card_validity', 'employer','relationship_number','principal_id', 'assurance_company',
                'principal_assurance_company','card_number','principal_card_validity','principal_employer','principal_client_contribution',
                'assurance_info');
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
            if (client && (client.assurance_company || client.principal_assurance_company)) {
                let company = client.assurance_company || client.principal_assurance_company
                let contribution = client.client_contribution || client.principal_contribution
                let affiliation_number = client.affiliation_number || client.card_number
                let validity = client.card_validity || client.principal_card_validity
                var currentDate = new Date();
                var dateToCompare = new Date(Date.parse(validity));
                if (currentDate <= dateToCompare && affiliation_number && contribution) {
                    var assurance = self.assurance_companies[company[0]];
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

    PosDB.include({
        name: 'openerp_pos_db', //the prefix of the localstorage data
        limit: 100,  // the maximum number of results returned by a search
        init: function (options) {
            options = options || {};
            this.name = options.name || this.name;
            this.limit = options.limit || this.limit;

            if (options.uuid) {
                this.name = this.name + '_' + options.uuid;
            }

            //cache the data in memory to avoid roundtrips to the localstorage
            this.cache = {};

            this.product_by_id = {};
            this.product_by_barcode = {};
            this.product_by_category_id = {};

            this.partner_sorted = [];
            this.partner_by_id = {};
            this.partner_by_barcode = {};
            this.partner_search_string = "";
            this.partner_write_date = null;
            this.partner_by_card_number = {}

            this.category_by_id = {};
            this.root_category_id = 0;
            this.category_products = {};
            this.category_ancestors = {};
            this.category_childs = {};
            this.category_parent = {};
            this.category_search_string = {};
        },

        _partner_search_string: function(partner){
            var str =  partner.name || '';
            if(partner.card_number){
                str += '|' + partner.card_number;
            }
            if(partner.barcode){
                str += '|' + partner.barcode;
            }
            if(partner.address){
                str += '|' + partner.address;
            }
            if(partner.phone){
                str += '|' + partner.phone.split(' ').join('');
            }
            if(partner.mobile){
                str += '|' + partner.mobile.split(' ').join('');
            }
            if(partner.email){
                str += '|' + partner.email;
            }
            if(partner.vat){
                str += '|' + partner.vat;
            }
            str = '' + partner.id + ':' + str.replace(':','') + '\n';
            return str;
        },
        add_partners: function(partners){
            var updated_count = 0;
            var new_write_date = '';
            var partner;
            for(var i = 0, len = partners.length; i < len; i++){
                partner = partners[i];

                var local_partner_date = (this.partner_write_date || '').replace(/^(\d{4}-\d{2}-\d{2}) ((\d{2}:?){3})$/, '$1T$2Z');
                var dist_partner_date = (partner.write_date || '').replace(/^(\d{4}-\d{2}-\d{2}) ((\d{2}:?){3})$/, '$1T$2Z');
                if (    this.partner_write_date &&
                    this.partner_by_id[partner.id] &&
                    new Date(local_partner_date).getTime() + 1000 >=
                    new Date(dist_partner_date).getTime() ) {
                    // FIXME: The write_date is stored with milisec precision in the database
                    // but the dates we get back are only precise to the second. This means when
                    // you read partners modified strictly after time X, you get back partners that were
                    // modified X - 1 sec ago.
                    continue;
                } else if ( new_write_date < partner.write_date ) {
                    new_write_date  = partner.write_date;
                }
                if (!this.partner_by_id[partner.id]) {
                    this.partner_sorted.push(partner.id);
                }
                this.partner_by_id[partner.id] = partner;
                if(partner.card_number && partner.principal_relationship.toLowerCase() === 'owner'){
                    this.partner_by_card_number[partner.card_number] = partner
                }

                updated_count += 1;
            }

            this.partner_write_date = new_write_date || this.partner_write_date;

            if (updated_count) {
                // If there were updates, we need to completely
                // rebuild the search string and the barcode indexing

                this.partner_search_string = "";
                this.partner_by_barcode = {};

                for (var id in this.partner_by_id) {
                    partner = this.partner_by_id[id];

                    if(partner.barcode){
                        this.partner_by_barcode[partner.barcode] = partner;
                    }
                    partner.address = (partner.street ? partner.street + ', ': '') +
                        (partner.zip ? partner.zip + ', ': '') +
                        (partner.city ? partner.city + ', ': '') +
                        (partner.state_id ? partner.state_id[1] + ', ': '') +
                        (partner.country_id ? partner.country_id[1]: '');
                    this.partner_search_string += this._partner_search_string(partner);
                }
            }
            return updated_count;
        },
        get_partner_by_card_number: function(card_number){
            return this.partner_by_card_number[card_number]
        },
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
        render_assurance_details(relationship){
            if(relationship === 'owner'){
                this.$('.dependant-detail').addClass('hidden');
                this.$('.principal-detail').removeClass('hidden')
            }   else{
                this.$('.principal-detail').addClass('hidden')
                this.$('.dependant-detail').removeClass('hidden');
            }
        },
        update_principal: function(principal_number) {
            let principal = this.pos.db.get_partner_by_card_number(principal_number)
            this.$('.principal-validator .fa-times').addClass('hidden');
            this.$('.principal-validator .fa-check').removeClass('hidden');
            let new_data = {
                'client-principal':(principal && principal.patient_name)|| "",
                'client-employer':(principal && principal.employer) || "",
                'client-contribution':(principal && principal.client_contribution) || "",
                'client-validity':(principal && principal.card_validity) || "",
                'client-company':(principal && principal.assurance_company[1]) || "",
            }
            for (const [key, value] of Object.entries(new_data)) {
                let elements = this.$(`.${key}`)
                elements.each(function(){
                    $(this).text(value)
                })
            }
            if(!principal){
                this.$('.principal-validator .fa-check').addClass('hidden');
                this.$('.principal-validator .fa-times').removeClass('hidden');
            }
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
            contents.on('click','.button.undo',function(){ self.undo_client_details(partner); });
            contents.on('change','.client-relationship',function(){
                let val = $('option:selected', this).val().toLocaleLowerCase()
                self.render_assurance_details(val)
            });
            contents.on('change','.client-principal',function(){
                let val =  $(this).val()
                if(val){
                    self.update_principal(val);
                }else{
                    self.$('.principal-validator .fa').addClass('hidden');
                }
            });
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
                        if (state.country_id[0] === value) {
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
            console.log(partner)
            this.render_assurance_details((partner && partner.principal_relationship) || "owner")
        },

        save_client_details: function(partner) {
            var self = this;

            var fields = {};
            this.$('.client-details-contents .detail').each(function(idx,el){
                if (self.integer_client_details.includes(el.name)){
                    var parsed_value = parseInt(el.value, 10);
                    if (isNaN(parsed_value)){
                        fields[el.name] = false;
                    }
                    else{
                        fields[el.name] = parsed_value
                    }
                }
                else{
                    fields[el.name] = el.value || false;
                }
            });

            if (!fields.name) {
                this.gui.show_popup('error',_t('A Customer Name Is Required'));
                return;
            }


            if (this.uploaded_picture) {
                fields.image_1920 = this.uploaded_picture;
            }

            fields.id = partner.id || false;
            console.log("fields",fields)
            var contents = this.$(".client-details-contents");
            contents.off("click", ".button.save");
            if(fields.principal_id){
                let principal = self.pos.db.get_partner_by_card_number(fields.principal_id)
                if(!principal){
                    this.gui.show_popup('error',_t('Invalid affiliation number'));
                    return;
                }
                fields.principal_id = principal.assurance_info[0];
            }

            rpc.query({
                model: 'res.partner',
                method: 'create_from_ui',
                args: [fields],
            })
                .then(function(partner_id){
                    self.saved_client_details(partner_id);
                }).catch(function(error){
                error.event.preventDefault();
                var error_body = _t('Your Internet connection is probably down.');
                if (error.message.data) {
                    var except = error.message.data;
                    error_body = except.arguments && except.arguments[0] || except.message || error_body;
                }
                self.gui.show_popup('error',{
                    'title': _t('Error: Could not Save Changes'),
                    'body': error_body,
                });
                contents.on('click','.button.save',function(){ self.save_client_details(partner); });
            });
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
            var validity = client.card_validity|| client.principal_card_validity
            var company = client.assurance_company || client.principal_assurance_company
            var contribution = client.client_contribution || client.principal_client_contribution
            var affiliation_number = client.affliation_number || client.card_number
            var dateToCompare = new Date(Date.parse(validity));
            if (company) {
                for (var i = 0; i < self.pos.payment_methods.length; i++) {
                    if(self.pos.payment_methods[i].is_assurance
                        && self.pos.payment_methods[i].assurance_company_id[0] === company[0]){
                        payment_method = self.pos.payment_methods[i];
                    }
                }
                var total_amount = self.pos.get_assurance_pricelist(client);
                if (currentDate <= dateToCompare &&affiliation_number && contribution) {
                    var insurance_amount = (total_amount / 100) * contribution;
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
                if (payment_method.is_assurance === true) {
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

});
