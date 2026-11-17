-- Uploaded DOCX are immutable. Keep previous files and preserve existing contract and
-- template IDs so stored documents and remembered template selections remain valid.
DO $migration$
DECLARE
  target_company CONSTANT uuid := '76e4d976-24cb-4b39-8888-0851b7266ade';
  word_mime CONSTANT text := 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  item record;
  target_contract uuid;
  new_key text;
  variables jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM yzy_contracts.companies WHERE id = target_company AND archived_at IS NULL) THEN
    RETURN;
  END IF;

  FOR item IN SELECT * FROM (VALUES
      ('Acto de seguro', 'acto_seguro.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, 'c0f77849-76da-4e6d-856b-3a265149a9bd'::uuid, 34099, '"0571b4b339c6db5694f92a1a5a5355ce"', 'e3f05d60-f211-5772-b855-d8bd9a6762b5'::uuid, '97faba7e-3403-5e3f-860c-8191d2c45813'::uuid, '"6a726a2ab84edf36a9a7096b5373792b"'::text, 'representante_seguro_nombre representante_seguro_nombre cliente_tratamiento cliente_nombre cliente_nombre cliente_nacionalidad cliente_estado_civil cliente_cedula cliente_cedula cliente_direccion_transito cantidad_cuotas_seguro cuotas_seguro_numeros cuotas_seguro_fechas cuotas_seguro_montos vehiculo_garantia monto_total_seguro_letras monto_total_seguro fecha_firma cliente_direccion nombre_del_notario'),
      ('Acuerdo de seguro', 'acuerdo_seguro.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, '0f0eee81-1fd1-420c-86c3-467dab24443b'::uuid, 26680, '"4cc18a7e654147929ef93fcf79138e67"', '0bdc9d7e-d694-5e00-b71e-6ad2cdf0af50'::uuid, '6588dfb0-e825-5af8-a58c-b3c12f07eaf4'::uuid, '"7a37b34687a1aad5d0e1b0f05cef5d7f"'::text, 'cliente_tratamiento cliente_nombre cliente_nombre cliente_nombre cliente_nacionalidad cliente_estado_civil cliente_cedula fecha_firma fecha_firma nombre_del_notario nombre_del_notario'),
      ('Autorización de datos', 'autorizacion_data.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, 'f58030b1-6d01-4c15-ab1b-c4e4d4f059d4'::uuid, 18195, '"0ba3a2afbda5ef526ec8948e7b456547"', 'c626cd42-8dd7-50cd-ae91-eb6568c16c24'::uuid, '6f93f03e-cfc1-5ba1-bae8-f8fbe10e67ed'::uuid, '"742a60b29384ff4f8bf8d3942ea7ad4f"'::text, 'cliente_tratamiento cliente_nombre cliente_nombre cliente_nombre cliente_nombre cliente_nombre cliente_nacionalidad cliente_estado_civil cliente_cedula cliente_direccion_transito vehiculo_garantia fecha_firma fecha_firma nombre_del_notario nombre_del_notario'),
      ('Autorización de desembolso', 'autorizacion_desembolso.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, 'ec3319bf-c673-41da-8055-703853a90b68'::uuid, 13577, '"d84c3adecf9b8f3b24a2515651dcecb7"', NULL::uuid, NULL::uuid, NULL::text, 'fecha_firma fecha_firma cliente_tratamiento cliente_nombre cliente_nacionalidad cliente_ocupacion cliente_cedula cliente_direccion_transito monto_desembolso distribucion_desembolso vehiculo_garantia cliente_nombre_firma'),
      ('Declaración jurada', 'declaracion_jurada.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, 'a50d30db-bdaa-4ad5-a1f7-a2afec63e2d8'::uuid, 16907, '"3422fa9a0bccabb0121b58b77214e503"', '4b90351c-81bd-5f81-8418-2434614ae87f'::uuid, '85172187-88c8-5fb8-a12c-1cb975f3633c'::uuid, '68f5ad1da90cfacb86b8bcf2c006ebcb'::text, 'cliente_tratamiento cliente_nombre cliente_nombre cliente_nombre cliente_nombre cliente_nacionalidad cliente_estado_civil cliente_cedula cliente_direccion_transito cliente_telefono cliente_correo cliente_ocupacion fecha_contrato vehiculo_garantia cliente_origen_ingresos fecha_firma fecha_firma nombre_del_notario nombre_del_notario'),
      ('Designación de cuenta', 'designacion_cuenta.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, '101415ea-560c-4f2b-b6c9-37290b9243ac'::uuid, 17909, '"e9bca23172f657e9680ded07640eeadd"', NULL::uuid, NULL::uuid, NULL::text, 'cliente_tratamiento cliente_nombre cliente_nombre cliente_nombre cliente_nacionalidad cliente_ocupacion cliente_cedula cliente_direccion_transito fecha_contrato monto_desembolso distribucion_desembolso fecha_firma fecha_firma cliente_nombre_firma nombre_del_notario nombre_del_notario'),
      ('Entrega voluntaria', 'entrega_voluntaria.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, 'e01bd695-3edb-435a-8686-1b11d3cf9440'::uuid, 17998, '"f0236742433d245a913f950efcf1f73e"', '0db3b8e3-5c8c-5fe0-9aee-0aab3fab2644'::uuid, 'e9e7dd2b-17de-5295-a535-0d1123e29f88'::uuid, '"4c7cb86f39507e757c7f27865d34c615"'::text, 'fecha_firma nombre_del_notario nombre_del_notario cliente_tratamiento cliente_tratamiento cliente_tratamiento cliente_nombre cliente_nombre cliente_nombre cliente_nombre cliente_nacionalidad cliente_nacionalidad cliente_nacionalidad cliente_estado_civil cliente_estado_civil cliente_estado_civil cliente_cedula_letras cliente_cedula_letras cliente_cedula_letras cliente_cedula cliente_cedula cliente_cedula cliente_direccion_transito cliente_direccion_transito cliente_direccion_transito vehiculo_garantia vehiculo_garantia vehiculo_garantia'),
      ('GPS', 'gps.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, '16fc0775-8917-4673-b0df-beb4b247fd51'::uuid, 28562, '"7658ddaf3153e6267f04c89febc3acf0"', '3c9395a2-b263-5ed9-9090-ac83e304f005'::uuid, 'df59204e-9d26-55ef-901e-0857a8b1bb27'::uuid, '"ebfb8e9dfcc3d88afa74d4aa908b84da"'::text, 'cliente_tratamiento cliente_nombre cliente_nombre cliente_nombre cliente_nacionalidad cliente_estado_civil cliente_cedula cliente_direccion_transito vehiculo_garantia fecha_firma fecha_firma nombre_del_notario nombre_del_notario'),
      ('Pagaré de seguro', 'pagare_seguro.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, 'ad0c0137-771c-4501-932d-d5aa9f1fdea7'::uuid, 8754, '"cb1ab04476c242fe10d0c9dfdc74ec1e"', 'a74e7b3b-5be7-549b-bb18-fdc7dae0fbd4'::uuid, '157aa883-0b7c-5786-97ab-29068e05caf5'::uuid, '26444be83892de4e7b39721f0a8cc46e'::text, 'fecha_firma nombre_del_notario nombre_del_notario cliente_tratamiento cliente_nombre cliente_nombre cliente_nacionalidad cliente_estado_civil cliente_cedula_letras cliente_cedula cliente_direccion_transito monto_total_seguro_letras monto_total_seguro cantidad_cuotas_seguro_letras cantidad_cuotas_seguro monto_cuota_seguro_letras monto_cuota_seguro fecha_primera_cuota_seguro fecha_ultima_cuota_seguro vehiculo_garantia'),
      ('Venta condicional', 'venta_condicional.docx', '23628754-b4b7-4c4f-b258-28d510f6e3f5'::uuid, '4ec2c2d2-dfff-418e-b927-67028a6fdc29'::uuid, 37314, '"406c8cf3c907400aa1f7476b0bcd6c3e"', '517a8cb3-04cc-527c-b908-f492378126c9'::uuid, '790fb92e-3e5d-5a7f-ac15-ffe608c279bc'::uuid, '"055be45fbd8eeda78e4c54e30bbc2fc3"'::text, 'cuotas_intereses_numeros cuotas_intereses_fechas cuotas_intereses_montos numero_cuota_final_capital fecha_cuota_final_capital cuota_final_capital_monto fecha_contrato cliente_tratamiento cliente_nombre cliente_nombre cliente_nacionalidad cliente_estado_civil cliente_cedula cliente_cedula cliente_direccion_transito vehiculo_tipo vehiculo_marca vehiculo_modelo vehiculo_anio vehiculo_color vehiculo_matricula vehiculo_chasis vehiculo_motor total_financiamiento_letras total_financiamiento fecha_abono_extraordinario_1 abono_extraordinario_1_monto fecha_abono_extraordinario_2 abono_extraordinario_2_monto fecha_ancla_cuota_extraordinaria fecha_firma cliente_direccion nombre_del_notario')
    ) AS files(label, filename, owner_id, upload_id, size_bytes, etag, contract_id, previous_upload, previous_etag, markers)
  LOOP
    new_key := format('users/%s/uploads/%s.docx', item.owner_id, item.upload_id);
    SELECT jsonb_agg(jsonb_build_object('key', key, 'occurrences', occurrences) ORDER BY first_pos)
      INTO variables
      FROM (SELECT key, count(*) AS occurrences, min(pos) AS first_pos
              FROM unnest(string_to_array(item.markers, ' ')) WITH ORDINALITY AS m(key, pos)
             GROUP BY key) counts;

    INSERT INTO yzy_contracts.file_uploads
      (id, owner_id, object_key, original_file_name, mime_type, declared_size_bytes, register_before, consumed_at)
    VALUES (item.upload_id, item.owner_id, new_key, item.filename, word_mime, item.size_bytes, now(), now());

    IF item.contract_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM yzy_contracts.contracts c
                  WHERE (c.company_id = target_company OR target_company = ANY(c.shared_company_ids))
                    AND c.deleted_at IS NULL AND (c.name = item.label OR c.original_file_name = item.filename))
      THEN
        RAISE EXCEPTION 'A template already exists for %', item.label;
      END IF;
      INSERT INTO yzy_contracts.contracts
        (owner_id, upload_id, company_id, name, original_file_name, mime_type, size_bytes, object_key, object_etag, status)
      VALUES (item.owner_id, item.upload_id, target_company, item.label, item.filename, word_mime,
              item.size_bytes, new_key, item.etag, 'converted')
      RETURNING id INTO target_contract;
      INSERT INTO yzy_contracts.templates (contract_id, owner_id, name, content_markdown, native_variables)
      VALUES (target_contract, item.owner_id, item.label, '', variables);
    ELSE
      UPDATE yzy_contracts.contracts
         SET upload_id = item.upload_id, object_key = new_key, size_bytes = item.size_bytes, object_etag = item.etag
       WHERE id = item.contract_id AND owner_id = item.owner_id AND company_id = target_company
         AND upload_id = item.previous_upload AND object_etag = item.previous_etag
         AND original_file_name = item.filename AND status = 'converted' AND deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The active Word changed before the update for %', item.label;
      END IF;
      UPDATE yzy_contracts.templates SET native_variables = variables
       WHERE contract_id = item.contract_id AND owner_id = item.owner_id AND content_markdown = '';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Native template missing for %', item.label;
      END IF;
    END IF;
  END LOOP;
END;
$migration$;
